import "./styles/home.scss";
import { useEffect, useRef, useState } from "preact/compat";
import { initFirebase } from "./utils/firebase";
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, addDoc, onSnapshot } from "firebase/firestore";

const firebaseApp = initFirebase();
const db = getFirestore(firebaseApp);

type MessageType = "text" | "file" | "picture" | "video" | "action";

type MessageAction = "mute" | "unmute" | "turnoncam" | "turnoffcam";

type MappedMessage<T extends MessageType> = T extends "text"
  ? string
  : T extends "file" | "video" | "picture"
  ? Blob
  : T extends "action"
  ? MessageAction
  : never;

type MessageData<T extends MessageType> = {
  type: T;
  data: MappedMessage<T>;
};

/*
iceServers: [
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.stunprotocol.org:3478" },
    { urls: "stun:stun.sipnet.net:3478" },
    { urls: "stun:stun.ideasip.com:3478" },
    { urls: "stun:stun.iptel.org:3478" },
    {
      urls: ["turn:numb.viagenie.ca"],
      credential: "muazkh",
      username: "webrtc@live.com",
    },
    {
      urls: ["turn:192.158.29.39:3478?transport=udp"],
      credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
      username: "28224511:1379330808",
    },
    {
      urls: ["turn:192.158.29.39:3478?transport=tcp"],
      credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
      username: "28224511:1379330808",
    },
    {
      urls: ["turn:turn.bistri.com:80"],
      credential: "homeo",
      username: "homeo",
    },
    {
      urls: ["turn:turn.anyfirewall.com:443?transport=tcp"],
      credential: "webrtc",
      username: "webrtc",
    },
    {
      urls: ["turn:13.250.13.83:3478?transport=udp"],
      username: "YzYNCouZM1mhqhmseWk6",
      credential: "YzYNCouZM1mhqhmseWk6",
    },
*/

const servers = {
  iceServers: [
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    {
      urls: ["turn:turn.anyfirewall.com:443?transport=tcp"],
      credential: "webrtc",
      username: "webrtc",
    },
    {
      urls: ["turn:13.250.13.83:3478?transport=udp"],
      username: "YzYNCouZM1mhqhmseWk6",
      credential: "YzYNCouZM1mhqhmseWk6",
    },
  ],
  iceCandidatePoolSize: 10,
};

export function App() {
  const clientVideo = useRef<never | HTMLVideoElement>(null);
  const remoteVideo = useRef<never | HTMLVideoElement>(null);
  const callButton = useRef<never | HTMLButtonElement>(null);
  const answerButton = useRef<never | HTMLButtonElement>(null);
  const hangupButton = useRef<never | HTMLButtonElement>(null);
  const CBButton = useRef<never | HTMLButtonElement>(null);
  const callInput = useRef<never | HTMLInputElement>(null);

  const localStream = useRef<never | MediaStream>(null);
  const remoteStream = useRef<never | MediaStream>(null);
  const videoSender = useRef<RTCRtpSender>();
  const audioSender = useRef<RTCRtpSender>();
  const pc = useRef<RTCPeerConnection>();
  const dc = useRef<RTCDataChannel | null>();
  const devices = useRef<MediaDeviceInfo[]>();

  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  useEffect(() => {
    setUpConnection();
  }, []);

  useEffect(() => {
    setAudioTrack();
  }, [audioEnabled]);

  useEffect(() => {
    setVideoTrack();
  }, [videoEnabled]);

  const setAudioTrack = async () => {
    if (!clientVideo?.current || !localStream?.current) {
      console.log("returned bc something involving refs 1");
      return;
    }

    if (audioEnabled) {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      localStream.current = new MediaStream([...localStream.current.getVideoTracks(), audioStream.getAudioTracks()[0]]);

      if (audioSender?.current) {
        audioSender.current.replaceTrack(localStream.current.getAudioTracks()[0]);
      }

      const data: MessageData<"action"> = {
        type: "action",
        data: "unmute",
      };

      clientVideo.current.srcObject = localStream.current;
      sendMessage(data);
    } else {
      if (localStream?.current) {
        localStream.current.getAudioTracks().forEach((track) => {
          track.stop();
        });
      }
      const data: MessageData<"action"> = {
        type: "action",
        data: "mute",
      };

      sendMessage(data);
    }
  };

  const setVideoTrack = async () => {
    if (!clientVideo?.current || !localStream?.current) {
      console.log("returned bc something involving refs 2");
      return;
    }

    if (videoEnabled) {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });

      console.log([videoStream.getVideoTracks()[0], ...localStream.current.getAudioTracks()]);

      localStream.current = new MediaStream([videoStream.getVideoTracks()[0], ...localStream.current.getAudioTracks()]);

      const data: MessageData<"action"> = {
        type: "action",
        data: "turnoncam",
      };

      clientVideo.current.srcObject = localStream.current;
      sendMessage(data);
      clientVideo.current.style.display = "";

      if (videoSender?.current) {
        videoSender.current.replaceTrack(localStream.current.getVideoTracks()[0]);
      }
    } else {
      if (localStream?.current) {
        localStream.current.getVideoTracks().forEach((track) => {
          track.stop();
        });
      }

      const data: MessageData<"action"> = {
        type: "action",
        data: "turnoffcam",
      };

      sendMessage(data);
      clientVideo.current.style.display = "none";
    }
  };

  // 2. Create an offer
  const handleCallClick = async () => {
    if (!hangupButton?.current || !callInput?.current) {
      console.log("returned bc something involving refs");
      return;
    }

    // Reference Firestore collections for signaling

    const callDoc = doc(collection(db, "calls"));
    const offerCandidates = collection(db, "calls", callDoc.id, "offerCandidates");
    const answerCandidates = collection(db, "calls", callDoc.id, "answerCandidates");

    callInput.current.value = callDoc.id;

    if (!pc?.current) return;

    // Get candidates for caller, save to db
    pc.current.onicecandidate = (event) => {
      event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
    };

    dc.current = pc.current.createDataChannel("MessageChannel");

    dc.current.onclose = handleStatusChange;
    dc.current.onopen = handleStatusChange;
    dc.current.onmessage = handleMessage;

    // Create offer
    const offerDescription = await pc.current.createOffer();
    await pc.current.setLocalDescription(offerDescription);

    const offer = {
      sdp: offerDescription.sdp,
      type: offerDescription.type,
    };

    await setDoc(callDoc, { offer });

    // Listen for remote answer
    onSnapshot(callDoc, (snapshot) => {
      if (!pc?.current) return;
      const data = snapshot.data();
      if (!pc.current.currentRemoteDescription && data?.answer) {
        const answerDescription = new RTCSessionDescription(data.answer);
        pc.current.setRemoteDescription(answerDescription);
      }
    });

    // When answered, add candidate to peer connection
    onSnapshot(answerCandidates, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          if (!pc?.current) return;
          const candidate = new RTCIceCandidate(change.doc.data());
          pc.current.addIceCandidate(candidate);
        }
      });
    });

    if (CBButton.current) {
      CBButton.current.disabled = false;
    }
  };

  const handleAnswerClick = async () => {
    if (!callInput?.current) {
      console.log("returned bc something involving refs");
      return;
    }

    const callId = callInput.current.value;
    const callDoc = doc(db, "calls", callId);
    const answerCandidates = collection(db, "calls", callDoc.id, "answerCandidates");
    const offerCandidates = collection(db, "calls", callDoc.id, "offerCandidates");

    if (!pc?.current) return;
    pc.current.onicecandidate = (event) => {
      event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
    };

    const callData = (await getDoc(callDoc)).data();

    if (!callData) {
      console.log("no calldata");
      return;
    }

    const offerDescription = callData.offer;
    await pc.current.setRemoteDescription(new RTCSessionDescription(offerDescription));

    const answerDescription = await pc.current.createAnswer();
    await pc.current.setLocalDescription(answerDescription);

    const answer = {
      type: answerDescription.type,
      sdp: answerDescription.sdp,
    };

    await updateDoc(callDoc, { answer });

    onSnapshot(offerCandidates, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        console.log("change", change);
        if (change.type === "added") {
          if (!pc?.current) return;
          console.log("added");
          let data = change.doc.data();
          pc.current.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
  };

  const handleHangupClick = async () => {
    closeConnection();
  };

  const closeConnection = () => {
    // close every old thing
    if (!pc?.current) return;
    pc?.current.close();
    dc?.current?.close();
    if (hangupButton?.current) {
      hangupButton.current.disabled = true;
    }

    // setup new connection
    setUpConnection();
  };

  const createPeer = () => {
    const peer = new RTCPeerConnection(servers);

    peer.ondatachannel = (ev) => {
      dc.current = ev.channel;

      dc.current.onclose = handleStatusChange;
      dc.current.onopen = handleStatusChange;
      dc.current.onmessage = handleMessage;
    };

    peer.ontrack = (ev: RTCTrackEvent) => {
      ev.streams[0].getTracks().forEach((track) => {
        if (!remoteStream?.current) return;
        remoteStream.current.addTrack(track);
      });
    };

    return peer;
  };

  const setUpConnection = async () => {
    // todo change camera
    // todo disable camera/mic
    if (!clientVideo?.current || !remoteVideo?.current || !callButton?.current || !answerButton?.current) {
      console.log("returned bc something involving refs");
      return;
    }

    remoteStream.current = new MediaStream();
    localStream.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

    // todo mute video doesn't work

    devices.current = await navigator.mediaDevices.enumerateDevices();

    pc.current = createPeer();
    dc.current = null;

    localStream.current.getAudioTracks().forEach((track) => {
      if (!localStream?.current || !pc?.current) return;
      audioSender.current = pc.current.addTrack(track, localStream.current);
    });
    localStream.current.getVideoTracks().forEach((track) => {
      if (!localStream?.current || !pc?.current) return;
      videoSender.current = pc.current.addTrack(track, localStream.current);
    });

    clientVideo.current.srcObject = localStream.current;
    remoteVideo.current.srcObject = remoteStream.current;

    callButton.current.disabled = false;
    answerButton.current.disabled = false;
  };

  const handleStatusChange = () => {
    const readyState = dc.current?.readyState;

    switch (readyState) {
      case "closed":
        closeConnection();
        break;
      case "open":
        if (!hangupButton?.current || !callInput?.current || !CBButton?.current) break;
        hangupButton.current.disabled = false;
        CBButton.current.disabled = true;
        callInput.current.value = "";
        break;
    }
    console.log("[Data Channel] Status : ", readyState);
  };

  const handleCBButtonClick = () => {
    if (!callInput?.current) {
      console.log("returned bc something involving refs");
      return;
    }
    navigator.clipboard.writeText(callInput.current.value);
  };

  const handleToggleAudio = () => {
    setAudioEnabled(!audioEnabled);
  };

  const handleToggleVideo = () => {
    setVideoEnabled(!videoEnabled);
  };

  const sendMessage = (data: MessageData<MessageType>) => {
    console.log("sending", JSON.stringify(data));
    dc.current?.send(JSON.stringify(data));
  };

  const handleMessage = (ev: MessageEvent<string>) => {
    const _ev = JSON.parse(ev.data) as MessageData<MessageType>;

    switch (_ev.type) {
      case "action":
        console.log("received action");
        const _ActionEvent = _ev as MessageData<"action">;
        handleActionMessage(_ActionEvent);
      case "file":
        break;
      case "picture":
        break;
      case "text":
        break;
      case "video":
        break;
    }
  };

  const handleActionMessage = (ev: MessageData<"action">) => {
    const action = ev.data;
    switch (action) {
      case "mute":
        break;
      case "unmute":
        break;
      case "turnoncam":
        if (!remoteVideo?.current) return;
        remoteVideo.current.style.display = "";
        break;
      case "turnoffcam":
        if (!remoteVideo?.current) return;
        remoteVideo.current.style.display = "none";
        break;
    }
  };

  const sendText = (message: string) => {
    const data: MessageData<"text"> = {
      type: "text",
      data: message,
    };
    sendMessage(data);
  };

  return (
    <>
      <h1>Zoom Clone</h1>
      <h2>1. Start your Webcam</h2>
      <div class="videos">
        <span>
          <h3>Local Stream</h3>
          <div className="video-container">
            <div className="wrapper">
              <video id="clientVideo" className="video" ref={clientVideo} autoPlay playsInline muted></video>
            </div>
            <div className="video-buttons">
              <button onClick={handleToggleAudio}>{audioEnabled ? "Mute" : "Unmute"}</button>
              <button onClick={handleToggleVideo}>{videoEnabled ? "Disable" : "Enable"} Camera</button>
              <button disabled={!videoEnabled}>Change Camera</button>
            </div>
          </div>
        </span>
        <span>
          <h3>Remote Stream</h3>
          <div className="video-container">
            <div className="wrapper">
              <video id="remoteVideo" className="video" ref={remoteVideo} autoPlay playsInline></video>
            </div>
          </div>
        </span>
      </div>

      <h2>2. Create a new Call</h2>
      <button id="callButton" onClick={handleCallClick} disabled ref={callButton}>
        Create Call (offer)
      </button>

      <h2>3. Join a Call</h2>
      <p>Answer the call from a different browser window or device</p>

      <input id="callInput" ref={callInput} />
      <button id="answerButton" onClick={handleAnswerClick} disabled ref={answerButton}>
        Answer
      </button>
      <br />
      <button id="CBButton" onClick={handleCBButtonClick} disabled ref={CBButton}>
        Copy to clipboard
      </button>

      <h2>4. Hangup</h2>

      <button id="hangupButton" disabled ref={hangupButton} onClick={handleHangupClick}>
        Hangup
      </button>
    </>
  );
}
