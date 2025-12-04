import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, MoreVertical } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import reqNotif from "@/sounds/newReq.mp3";
import accNotif from "@/sounds/accepted.mp3";
import leaveNotif from "@/sounds/left.mp3";
const logging = true;
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SmoothScrollWrapper from "@/components/ui/Scrollbar";

interface UserRequest {
  id: number;
  username: string;
  isRemoving: boolean;
  isAdding?: boolean;
  disabled: boolean;
  key?: string;
  whitelisted?: boolean; // new optional property
}

interface AcceptedUser {
  id: number;
  username: string;
  isRemoving: boolean;
  isAdding?: boolean;
  disabled: boolean;
  key?: string;
  whitelisted?: boolean; // new optional property
}

interface Room {
  name: string;
  id: number;
  text: string;
}

export const MainPanel = () => {
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [acceptedUsers, setAcceptedUsers] = useState<AcceptedUser[]>([]);
  const [nextId, setNextId] = useState(1);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const terminalContentRef = useRef<HTMLDivElement>(null);
  const newReqAudio = new Audio(reqNotif);
  newReqAudio.volume = 0.3;
  const accReqAudio = new Audio(accNotif);
  accReqAudio.volume = 0.3;
  const leftAudio = new Audio(leaveNotif);
  leftAudio.volume = 0.3;
  const originalTitle = "Syncify";

  useEffect(() => {
    if (!terminalContentRef.current) return;
    const el = terminalContentRef.current;

    // Wait for the DOM to update and paint twice
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          el.scrollTo({
            top: el.scrollHeight,
            behavior: "smooth",
          });
        }, 100);
      });
    });
  }, [terminalLines]);

  useEffect(() => {
    // 1️⃣ Fetch room data
    const fetchRoom = async () => {
      const room = await fetch("/api/room/");
      const data = await room.json();
      setRoom((prev) => ({ ...prev, id: data.data.room_id }));
      if (logging) console.log(data);
    };
    fetchRoom();

    // 2️⃣ Connect WebSocket for join requests
    const wsUrl = window.location.origin
      .replace(/^http/, "ws") // http→ws / https→wss
      .replace(/:\d+/, ":8000"); // replace any port with 8000

    const ws = new WebSocket(`${wsUrl}/api/ws`);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "rehydrate") {
        if (logging) console.log("rehydrating:", msg.requests, msg.allowed);

        setTerminalLines(msg.logs ?? []); // hydrate logs
        // populate pending requests
        setRequests(
          (msg.requests ?? []).map((user, idx) => ({
            id: idx,
            username: user.name ?? "Unknown",
            key: user.key ?? "",
            isAdding: false,
            isRemoving: false,
            disabled: false,
            whitelisted: isUserWhitelisted(user.key) || user.whitelisted,
          })) as UserRequest[]
        );
        if (logging) console.log(requests);

        // populate allowed users
        setAcceptedUsers(
          (msg.allowed ?? []).map((user, idx) => ({
            id: idx,
            username: user.name ?? "Unknown",
            key: user.key ?? "",
            isAdding: false,
            isRemoving: false,
            disabled: !user.canControl,
            whitelisted: isUserWhitelisted(user.key) || user.whitelisted,
          })) as AcceptedUser[]
        );
      }

      if (msg.type === "new_request") {
        const user = msg.user;
        console.log("new request from", user);

        setNextId((prevId) => {
          setRequests((prevRequests) => {
            // 🧠 Duplicate guard — if a request with same key already exists, ignore
            const alreadyExists = prevRequests.some(
              (req) => req.key === user.key
            );
            if (alreadyExists) return prevRequests;

            const newRequest: UserRequest = {
              id: prevId,
              username: user.name,
              key: user.key,
              isAdding: true,
              isRemoving: false,
              disabled: !user.canControl,
              whitelisted: user.whitelisted,
            };

            // Toast after adding
            setTimeout(() => {
              if (!newRequest.whitelisted) newReqAudio.play();
              toast({
                title: "Request Added",
                description: `${user.name} added to queue`,
                duration: 1000,
              });
            }, 50);

            // Animate in
            setTimeout(() => {
              setRequests((current) =>
                current.map((req) =>
                  req.id === newRequest.id ? { ...req, isAdding: false } : req
                )
              );
            }, 50);

            document.title = `${user.name} wants to join`;
            setTimeout(() => {
              document.title = originalTitle;
            }, 5000);
            // const flashText = `${originalTitle} - ${user.name} wants to join`;
            // let flashes = 0;
            // const flashInterval = setInterval(() => {
            //   document.title = flashes % 2 === 0 ? flashText : originalTitle;
            //   flashes++;
            //   if (flashes >= 10) {
            //     // 3 flashes = 6 toggles
            //     clearInterval(flashInterval);
            //     document.title = originalTitle; // restore
            //   }
            // }, 500); // toggle every 500ms

            return [...prevRequests, newRequest];
          });

          return prevId + 1;
        });
      }

      if (msg.type === "auto_accepted") {
        const user = msg.user;

        setTimeout(() => {
          const newUser: AcceptedUser = {
            id: user.id,
            username: user.name,
            key: user.key, // keep key for future actions
            isRemoving: false,
            isAdding: true,
            disabled: !user.canControl,
            whitelisted: true,
          };
          setAcceptedUsers((prev) => [...prev, newUser]);

          setTimeout(() => {
            setAcceptedUsers((prev) =>
              prev.map((u) =>
                u.id === user.id ? { ...u, isAdding: false } : u
              )
            );
          }, 50);
        }, 500);
      }

      if (msg.type === "logs") {
        {
          if (logging) console.log("added a new log");
          setTimeout(() => {
            setTerminalLines((prev) => [...prev, msg.message]);
          }, 100);
        }
      }
      if (msg.type === "user_left") {
        const user = msg.user;
        const animationDuration = 500; // match your CSS animation duration
        leftAudio.play();

        // Mark as removing
        setRequests((prev) =>
          prev.map((req) =>
            req.key === user.key ? { ...req, isRemoving: true } : req
          )
        );
        setAcceptedUsers((prev) =>
          prev.map((u) => (u.key === user.key ? { ...u, isRemoving: true } : u))
        );

        // Show toast
        toast({
          title: "User Left",
          description: `${user.name} has left the session`,
          duration: 1000,
        });

        // Actually remove after animation
        setTimeout(() => {
          setRequests((prev) => prev.filter((req) => req.key !== user.key));
          setAcceptedUsers((prev) => prev.filter((u) => u.key !== user.key));
        }, animationDuration);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // store all timeouts for this render
    const timers: number[] = [];

    requests.forEach((req) => {
      if (req.key && isUserWhitelisted(req.key)) {
        // schedule auto-accept after 1s
        req.whitelisted = true;
        const timerId = window.setTimeout(() => {
          document.title = `${req.username} joined (whitelist)`;
          setTimeout(() => {
            document.title = originalTitle;
          }, 5000);
          acceptRequest(req.id);
          if (logging)
            console.log(`${req.username} (id ${req.id}) auto-accepted ✅`);
        }, 1000);

        timers.push(timerId);
      }
    });

    // cleanup function: runs before next effect or on unmount
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, isUserWhitelisted]);

  const [room, setRoom] = useState<Room>({
    name: "",
    id: 0,
    text: "roooom ID:",
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);

  const [roomVisible, setRoomVisible] = useState(false);

  useEffect(() => {
    const roomName = localStorage.getItem("roomName")?.trim();
    if (roomName && roomName != "") {
      setRoom((prev) => ({ ...prev, name: roomName }));
    } else {
      setRoom((prev) => ({ ...prev, name: "Syncify Control Panel" }));
    }

    const roomText = localStorage.getItem("roomText")?.trim();
    if (roomText && roomText != "") {
      setRoom((prev) => ({ ...prev, text: roomText }));
    } else {
      setRoom((prev) => ({ ...prev, text: "rooom ID:" }));
    }

    setTimeout(() => {
      setRoomVisible(true);
    }, 1000);
    // Focus the input
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      localStorage.setItem("roomName", room.name);
      localStorage.setItem("roomText", room.text);
    }, 1000);

    const timeout = setTimeout(() => {
      if (inputRef.current.value.trim() == "")
        inputRef.current.value = "Syncify control panel";
      if (textRef.current.value.trim() == "") {
        textRef.current.size = "roooom ID:".length;
        textRef.current.value = "roooom ID:";
      }
    }, 5000);

    return () => {
      clearTimeout(handler);
      clearTimeout(timeout);
    };
  }, [room]);

  const acceptRequest = async (id: number) => {
    accReqAudio.play();
    const request = requests.find((req) => req.id === id);
    if (logging) console.log(request);
    if (!request || !request.key) return; // make sure key exists

    try {
      // Call backend to allow this user
      await fetch("/api/set-scope", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-key": request.key, // send key to identify user
        },
        body: JSON.stringify({
          action: "accept",
          whitelisted: request.whitelisted,
        }),
      });

      // Local UI updates
      setRequests((prev) =>
        prev.map((req) => (req.id === id ? { ...req, isRemoving: true } : req))
      );

      setTimeout(() => {
        setRequests((prev) => prev.filter((req) => req.id !== id));

        const newUser: AcceptedUser = {
          id: request.id,
          username: request.username,
          key: request.key, // keep key for future actions
          isRemoving: false,
          isAdding: true,
          disabled: false,
          whitelisted: request.whitelisted,
        };
        setAcceptedUsers((prev) => [...prev, newUser]);

        setTimeout(() => {
          setAcceptedUsers((prev) =>
            prev.map((user) =>
              user.id === id
                ? { ...user, isAdding: false, disabled: false }
                : user
            )
          );
          setTimeout(() => {
            setAcceptedUsers((prev) =>
              prev.map((user) =>
                user.id === newUser.id ? { ...user, disabled: request.disabled } : user
              )
            );
          }, 500);
        }, 50);

        toast({
          title: "Request Accepted",
          description: `${request.username} has been accepted`,
          duration: 1000,
        });
      }, 500);
    } catch (err) {
      console.error("Failed to accept user:", err);
      toast({
        title: "Error",
        description: `Failed to accept ${request.username}`,
        variant: "destructive",
        duration: 2000,
      });
    }
  };

  const rejectRequest = async (id: number) => {
    const request = requests.find((req) => req.id === id);
    if (!request || !request.key) return; // make sure key exists

    try {
      // Call backend to reject this user
      await fetch("/api/set-scope", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-key": request.key, // send key to identify user
        },
        body: JSON.stringify({ action: "reject" }),
      });

      // Local UI updates
      setRequests((prev) =>
        prev.map((req) => (req.id === id ? { ...req, isRemoving: true } : req))
      );

      setTimeout(() => {
        setRequests((prev) => prev.filter((req) => req.id !== id));

        toast({
          title: "Request Rejected",
          description: `${request.username} has been rejected`,
          variant: "destructive",
          duration: 1000,
        });
      }, 500);
    } catch (err) {
      console.error("Failed to reject user:", err);
      toast({
        title: "Error",
        description: `Failed to reject ${request.username}`,
        variant: "destructive",
        duration: 2000,
      });
    }
  };

  const removeAcceptedUser = async (id: number) => {
    const user = acceptedUsers.find((u) => u.id === id);
    if (!user || !user.key) return;

    try {
      // Call backend to remove this user
      await fetch("/api/set-scope", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-key": user.key, // send key to identify user
        },
        body: JSON.stringify({ action: "remove" }),
      });

      // Local UI updates
      setAcceptedUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, isRemoving: true } : u))
      );

      setTimeout(() => {
        setAcceptedUsers((prev) => prev.filter((u) => u.id !== id));
        toast({
          title: "User Removed",
          description: `${user.username} has been removed`,
          duration: 1000,
        });
      }, 500);
    } catch (err) {
      console.error("Failed to remove user:", err);
      toast({
        title: "Error",
        description: `Failed to remove ${user.username}`,
        variant: "destructive",
        duration: 2000,
      });
    }
  };

  const toggleWhitelist = async (id: number) => {
    const user = acceptedUsers.find((u) => u.id === id);
    if (!user || !user.key) return;

    let whitelist = JSON.parse(localStorage.getItem("whitelist") || "[]");

    if (whitelist.includes(user.key)) {
      // Remove if already whitelisted
      whitelist = whitelist.filter((key) => key !== user.key);
      if (logging) console.log("removed from whitelist");
    } else {
      // Add if not present
      if (logging) console.log("added to whitelist");
      whitelist.push(user.key);
    }

    localStorage.setItem("whitelist", JSON.stringify(whitelist));

    const action = user.whitelisted ? "remove_whitelist" : "whitelist";

    try {
      await fetch("/api/set-scope", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-key": user.key,
        },
        body: JSON.stringify({ action }),
      });

      setAcceptedUsers((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, whitelisted: !u.whitelisted } : u
        )
      );

      toast({
        title: "User Updated",
        description: `${user.username} is now ${
          action === "whitelist" ? "whitelisted" : "removed from whitelist"
        }`,
        duration: 1000,
      });
    } catch (err) {
      console.error("Failed to toggle whitelist:", err);
      toast({
        title: "Error",
        description: `Failed to ${action} ${user.username}`,
        variant: "destructive",
        duration: 2000,
      });
    }
  };

  function isUserWhitelisted(userKey) {
    const whitelist = JSON.parse(localStorage.getItem("whitelist") || "[]");
    return whitelist.includes(userKey);
  }

  const toggleDisable = async (id: number) => {
    const user = acceptedUsers.find((u) => u.id === id);
    if (!user || !user.key) return;

    const action = user.disabled ? "enable" : "disable";

    try {
      // Tell backend to update scope
      await fetch("/api/set-scope", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-key": user.key,
        },
        body: JSON.stringify({ action }),
      });

      // Update local state
      setAcceptedUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, disabled: !u.disabled } : u))
      );

      toast({
        title: "User Updated",
        description: `${user.username} is now ${
          action === "disable" ? "disabled" : "enabled"
        }`,
        duration: 1000,
      });
    } catch (err) {
      console.error("Failed to toggle disable:", err);
      toast({
        title: "Error",
        description: `Failed to ${action} ${user.username}`,
        variant: "destructive",
        duration: 2000,
      });
    }
  };

  return (
    <div
      className="relative flex flex-col w-full max-h-[calc(100vh-20.7%-2rem)] mt-[12vh] overflow-visible"
      style={{ height: "calc(100vh-20.7%-2rem)" }}
    >
      <div className=" flex gap-12 w-full mx-auto animate-fade-in2 -translate-y-2/3 duration-300">
        {/* Left Queue - Active Users */}
        <div
          className={`opacity-100 crafty absolute top-[25vh] translate-x-[5vw] -translate-y-1/2 w-1/4 max-w-sm z-10 transition-opacity duration-300 `}
        >
          <div className="queues bg-card/80 backdrop-blur-sm rounded-xl p-6 border border-border shadow-2xl min-h-[100px]">
            <h3 className="text-3xl text-center font-semibold text-primary mb-4">
              Accepted Users
            </h3>
            <div className="transition-all duration-300">
              <div
                className={`flex items-center justify-center text-center overflow-hidden transition-all duration-500 ${
                  acceptedUsers.length !== 0
                    ? "opacity-0 max-h-0"
                    : "opacity-100 max-h-[40px]"
                }`}
              >
                <p className="text-muted-foreground text-lg">
                  No accepted users yet
                </p>
              </div>

              {acceptedUsers.length > 0 &&
                acceptedUsers.map((user) => (
                  <div
                    key={user.id}
                    className={`
                      transition-all duration-500 ease-in-out 
                      ${
                        user.disabled
                          ? "opacity-50 grayscale mt-4"
                          : user.isRemoving
                          ? "opacity-0 -translate-y-4 max-h-0 overflow-hidden mt-0"
                          : user.isAdding
                          ? "opacity-0 translate-y-4 max-h-0"
                          : "opacity-100 translate-y-0 max-h-[200px] mt-4"
                      }
                    `}
                  >
                    <div className="bg-secondary rounded-lg p-2 px-4 border border-border">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex flex-row space-x-1 align-middle items-center">
                            <h3 className="font-normal text-2xl">
                              {user.username}
                            </h3>
                            <button
                              onClick={() => toggleWhitelist(user.id)}
                              title={`${
                                user.whitelisted
                                  ? "User will join automatically next time"
                                  : "Click to allow user to join automatically"
                              }`}
                              className="rounded"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 480 480" // adjust based on original SVG
                                className="w-6 h-6 hover:scale-125 transition-transform" // Tailwind example
                              >
                                <path
                                  clipRule="evenodd"
                                  d="M343.939,138.178c-68.255,2.582-68.302,70.007-68.302,70.006   c0,0-1.951-67.404-68.302-70.006c-24.021,0-64.889,26.108-64.889,87.082c0,62.697,133.191,177.589,133.191,177.589   c49.23-49.23,133.015-116.61,133.19-177.589C408.998,164.286,367.959,138.178,343.939,138.178z"
                                  fill={`${
                                    !user.whitelisted ? "#808080" : "#FFB6C1"
                                  }`}
                                  fillRule="evenodd"
                                />

                                <path
                                  d="M313.203,109.151l-0.324,0.005c-37.104,1.146-57.835,21.478-67.069,40.699   c-0.439,0.889-0.85,1.774-1.25,2.657c-0.424-0.909-0.86-1.819-1.326-2.734c-9.46-19.098-30.041-39.432-66.299-40.622l-0.338-0.005   c-29.475,0.071-73.348,30.516-73.426,95.619c0.714,36.907,35.309,80.67,68.822,118.054c33.697,36.991,67.178,65.862,67.333,65.998   c3.395,2.926,8.44,2.738,11.614-0.428c48.333-49.314,134.18-115.243,135.688-183.599v-0.012c0-0.124,0-0.26,0-0.396   C386.545,139.524,342.602,109.216,313.203,109.151z M369.553,204.744c1.115,51.601-74.564,117.299-124.927,165.972   c-10.901-9.774-35.45-32.417-60.005-59.389c-33.084-35.732-65.083-80.768-64.374-106.557c0.058-56.713,37.599-78.356,56.211-78.54   c29.957,1.459,43.482,16.096,51.574,31.318c3.908,7.635,6.041,15.398,7.14,21.179c1.111,5.781,1.138,9.215,1.196,9.215   c0.13,4.662,3.993,8.354,8.655,8.29c4.663-0.065,8.415-3.869,8.415-8.532c-0.003-0.003-0.005-0.095-0.003-0.253h0.003   c0-0.007-0.002-0.027-0.003-0.04c0.026-2.134,0.658-15.982,7.664-29.943c7.837-15.112,21.224-29.744,52.238-31.233   c18.589,0.179,56.157,21.742,56.216,78.156C369.553,204.5,369.553,204.619,369.553,204.744z"
                                  fill="#959595"
                                />
                              </svg>
                            </button>
                          </div>
                          <p className="text-lg text-muted-foreground">
                            ID: {user.key.slice(0, 10)}...
                          </p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="crafty font-normal bg-background border-border z-50">
                            <DropdownMenuItem
                              title={`${
                                user.whitelisted
                                  ? "User will join automatically next time"
                                  : "Click to allow user to join automatically"
                              }`}
                              onClick={() => toggleWhitelist(user.id)}
                              className={`cursor-pointer text-[18px] ${
                                user.whitelisted ? "bg-green-500/60" : ""
                              }`}
                            >
                              Whitelist
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              onClick={() => toggleDisable(user.id)}
                              className="cursor-pointer text-[18px]"
                              title={
                                user.disabled
                                  ? "Allow user to control playback?"
                                  : "Click to stop user from controlling playback"
                              }
                            >
                              {user.disabled
                                ? "Enable Control"
                                : "Disable Control"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => removeAcceptedUser(user.id)}
                              className="cursor-pointer font-normal text-[20px] text-red-500"
                              title="Kick user and disable new requests from this user for 30 seconds"
                            >
                              Remove User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Room name */}
        <div className="flex -translate-y-[20px] flex-col w-full items-center">
          <div
            className="flex left-1/2 z-999 w-full items-center -translate-y-3/4 flex-col transform text-center flex-1"
            style={{
              fontFamily: '"Quicksand", sans-serif',
              color: "hsl(142, 73%, 42%)",
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={room.name}
              onChange={(e) =>
                setRoom((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="Syncify control panel"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              // disabled={acceptedUsers.length != 0}
              className={`opacity-100 jersey bg-transparent border-none outline-none text-4xl font-bold text-center transition-opacity duration-300 placeholder:text-muted-foreground `}
            />
          </div>
          {/* Middle / Stepcard / Center Content - Main Step Card */}
          <div className="flex-1 text-center transition-all top-[3vh] duration-300 max-h-[365px] pt-0 relative">
            {/* Confetti Animation */}

            <div
              className="relative step-card mx-auto max-h-[38vh] max-w-[47.4vw] p-0 overflow-hidden"
              style={{ paddingTop: 50 }}
            >
              <div className="flex flex-col  items-center justify-center text-center relative">
                <h2
                  className={`opacity-0 absolute max-h-0 jersey flex flex-row pr-10 justify-center w-full transition-all duration-1000 items-center text-center text-3xl font-bold mb-4 text-success }`}
                >
                  <input
                    type="text"
                    ref={textRef}
                    placeholder="roooom ID:"
                    size={
                      room.text.length == 0
                        ? "roooom ID:".length
                        : room.text.length
                    }
                    onChange={(e) =>
                      setRoom((prev) => ({ ...prev, text: e.target.value }))
                    }
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    // disabled={acceptedUsers.length != 0}
                    className={`bg-transparent border-none outline-none text-3xl font-bold text-center transition-opacity duration-300 placeholder:text-muted-foreground ${
                      roomVisible ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span
                    title="Click to copy room ID"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(String(room.id))
                        .then(() => {
                          toast({
                            title: "Copied!",
                            description: `Room ID ${room.id} copied to clipboard.`,
                            duration: 1000, // auto-dismiss after 3 seconds
                          });
                        })
                        .catch((err) => {
                          toast({
                            title: "Error",
                            description: "Failed to copy to clipboard",
                            variant: "destructive",
                            duration: 1000, // auto-dismiss after 3 seconds
                          });
                          console.error(err);
                        });
                    }}
                    className="cursor-pointer transition-all hover:text-purple-300 hover:scale-110"
                  >
                    {room.id}
                  </span>
                </h2>
              </div>

              <div
                className={`opacity-100 max-h-[54.8%] p-4 bg-success/20 border border-success/30 rounded-2xl transition-all duration-500 ease-in-out overflow-hidden `}
              >
                <ul className="crafty font-normal text-[20px] text-muted-foreground space-y-2 text-left">
                  <li className="flex items-start">
                    <span className="text-lg mr-2">👥</span>
                    <span>
                      Share the
                      <span
                        title="Click to copy the extension link"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(
                              "https://github.com/jnandevupadhya/syncify/tree/main/extension#-syncify-extension--join-listening-sessions"
                            )
                            .then(() => {
                              toast({
                                title: "Copied!",
                                description: `Extension link copied to clipboard.`,
                                duration: 1000, // auto-dismiss after 3 seconds
                              });
                            })
                            .catch((err) => {
                              toast({
                                title: "Error",
                                description: "Failed to copy to clipboard",
                                variant: "destructive",
                                duration: 1000, // auto-dismiss after 3 seconds
                              });
                              console.error(err);
                            });
                        }}
                        className="text-success cursor-pointer transition-all hover:text-purple-300 hover:scale-110"
                      >
                        {" extension link "}
                      </span>
                      with your friends :)
                    </span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-lg mr-2">💬</span>
                    <span>
                      Ask them to enter{" "}
                      <span
                        title="Click to copy room ID"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(String(room.id))
                            .then(() => {
                              toast({
                                title: "Copied!",
                                description: `Room ID ${room.id} copied to clipboard.`,
                                duration: 1000, // auto-dismiss after 3 seconds
                              });
                            })
                            .catch((err) => {
                              toast({
                                title: "Error",
                                description: "Failed to copy to clipboard",
                                variant: "destructive",
                                duration: 1000, // auto-dismiss after 3 seconds
                              });
                              console.error(err);
                            });
                        }}
                        className="text-success cursor-pointer transition-all hover:text-purple-300 hover:scale-110"
                      >
                        {room.id}
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-lg mr-2">🎵</span>
                    <span>Enjoy synchronized music experiences</span>
                  </li>
                </ul>
              </div>

              <p
                className={`opacity-100 max-h-[500px] mt-3 crafty text-[18px] text-muted-foreground transition-all duration-500 ease-in-out overflow-hidden `}
              >
                You, your friends, your music, all together C: 💜
              </p>
            </div>

            {/* Terminal Window */}

            <div
              className={`opacity-100 max-h-[35.04vh] mt-[5.96vh] transition-all duration-500 ease-in-out overflow-hidden `}
            >
              {
                <SmoothScrollWrapper>
                  <div className="max-w-lg mx-auto">
                    <div className="bg-background/50  rounded-lg  border-2 border-foreground/10 overflow-hidden">
                      {/* Logs Header */}
                      <div className="bg-muted/50 px-4 py-2 flex items-center gap-2">
                        <div className="flex gap-1.5 transition-colors duration-300">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              terminalLines.length == 0
                                ? "bg-gray-500/80"
                                : "bg-red-500/80"
                            } `}
                          ></div>
                          <div
                            className={`w-3 h-3 rounded-full ${
                              terminalLines.length == 0
                                ? "bg-gray-500/80"
                                : "bg-yellow-500/80"
                            } `}
                          ></div>
                          <div
                            className={`w-3 h-3 rounded-full ${
                              terminalLines.length == 0
                                ? "bg-gray-500/80"
                                : "bg-green-500/80"
                            } `}
                          ></div>
                        </div>
                        <span className="text-xs text-muted-foreground font-mono ml-2">
                          logs
                        </span>
                      </div>

                      {/* Logs Content */}

                      <div
                        ref={terminalContentRef}
                        className="cascadia logs-container font-extralight p-[1.5vh] h-[27vh] overflow-y-auto font-mono text-sm bg-background/50 text-left"
                      >
                        {terminalLines.length === 0 ? (
                          <div className="text-muted-foreground/50 italic">
                            Waiting for messages...
                          </div>
                        ) : (
                          terminalLines.map((line, index) => (
                            <div
                              key={index}
                              className="animate-[fade-in_0.5s_ease-in-out_forwards] mb-1"
                            >
                              <span className="text-success/70">$</span> {line}
                            </div>
                          ))
                        )}
                      </div>

                      {/* log content end */}
                    </div>
                  </div>
                </SmoothScrollWrapper>
              }
              {/* logs end */}
            </div>

            {/* Terminal window end */}
          </div>

          {/* step card end */}

          {/* Right Queue - Join Requests */}
          <div
            className={`opacity-100 absolute right-0 top-[25vh] translate-x-[-5vw] -translate-y-1/2 w-1/4 max-w-sm z-10 transition-opacity duration-300 `}
          >
            <div className="queues crafty bg-card/80 backdrop-blur-sm rounded-xl p-6 pb-2 border border-border shadow-2xl min-h-[100px]">
              <h3 className="text-3xl text-center font-semibold text-primary mb-4">
                Join Requests
              </h3>
              <div className="">
                <div
                  className={`flex items-center transition-all justify-center text-center ${
                    requests.length == 0
                      ? "opacity-100 max-h-[40px] pb-6"
                      : "opacity-0 max-h-0"
                  }`}
                >
                  <p className={`text-muted-foreground text-lg `}>
                    No requests in queue
                  </p>
                </div>
                {requests.map((request) => (
                  <div
                    key={request.id}
                    className={`
    transition-all duration-500 ease-in-out 
    ${
      request.isRemoving
        ? "opacity-0 -translate-y-4 max-h-0 overflow-hidden"
        : request.isAdding
        ? "opacity-0 translate-y-4 max-h-0 mb-4"
        : "opacity-100 translate-y-0 max-h-[200px] mb-4"
    }
  `}
                  >
                    <div className="bg-secondary rounded-lg p-4 border border-border">
                      <div className="">
                        <div className="flex items-center -translate-y-1/4 justify-start">
                          <h3 className="font-normal text-2xl">
                            {request.username}
                          </h3>
                        </div>
                        <p className="text-lg text-muted-foreground -translate-y-1/3">
                          ID: {request.key.slice(0, 10)}...
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1 h-8 text-lg gap-1 bg-green-600 text-white hover:bg-green-700"
                            onClick={() => acceptRequest(request.id)}
                          >
                            <Check className="h-3 w-3" />
                            Accept
                          </Button>

                          <Button
                            variant="destructive"
                            size="sm"
                            className="flex-1 h-8 text-lg gap-1"
                            onClick={() => rejectRequest(request.id)}
                          >
                            <X className="h-3 w-3" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* right queue end */}
        </div>
      </div>
    </div>
  );
};
