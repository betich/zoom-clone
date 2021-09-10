import "./styles.scss";
import { useEffect, useRef, useState } from "preact/compat";
import { initFirebase } from "./utils/firebase";
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, addDoc, onSnapshot } from "firebase/firestore";

const firebaseApp = initFirebase();
const db = getFirestore(firebaseApp);

const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

let pc: RTCPeerConnection
let dc: RTCDataChannel | null

export function App() {
  const clientVideo = useRef<never | HTMLVideoElement>(null);
  const remoteVideo = useRef<never | HTMLVideoElement>(null);
  const callButton = useRef<never | HTMLButtonElement>(null);
  const answerButton = useRef<never | HTMLButtonElement>(null);
  const webcamButton = useRef<never | HTMLButtonElement>(null);
  const hangupButton = useRef<never | HTMLButtonElement>(null);
  const CBButton = useRef<never | HTMLButtonElement>(null);
  const callInput = useRef<never | HTMLInputElement>(null);

  // 1. Setup media sources
  const handleWebcamClick = async () => {

    setUpConnection()

  };

  // 2. Create an offer
  const handleCallClick = async () => {
    if (!hangupButton?.current || !callInput?.current) {
      console.log("returned bc something involving refs");
      return;
    }

    // Reference Firestore collections for signaling
    /* idk how to implement this (subcollections) */

    const callDoc = doc(collection(db, "calls"));
    const offerCandidates = collection(db, "calls", callDoc.id, "offerCandidates");
    const answerCandidates = collection(db, "calls", callDoc.id, "answerCandidates");

    callInput.current.value = callDoc.id;

    // Get candidates for caller, save to db
    pc.onicecandidate = (event) => {
      event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
    };

    dc = pc.createDataChannel("MessageChannel")

    dc.onclose = handleStatusChange
    dc.onopen = handleStatusChange

    // Create offer
    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    const offer = {
      sdp: offerDescription.sdp,
      type: offerDescription.type,
    };

    await setDoc(callDoc, { offer });

    // Listen for remote answer
    onSnapshot(callDoc, (snapshot) => {
      const data = snapshot.data();
      if (!pc.currentRemoteDescription && data?.answer) {
        const answerDescription = new RTCSessionDescription(data.answer);
        pc.setRemoteDescription(answerDescription);
      }
    });

    // When answered, add candidate to peer connection
    onSnapshot(answerCandidates, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          pc.addIceCandidate(candidate);
        }
      });
    });
    
    if(CBButton.current) {
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

    pc.onicecandidate = (event) => {
      event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
    };

    const callData = (await getDoc(callDoc)).data();

    if (!callData) return;
    const offerDescription = callData.offer;
    await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    const answer = {
      type: answerDescription.type,
      sdp: answerDescription.sdp,
    };

    await updateDoc(callDoc, { answer });

    onSnapshot(offerCandidates, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        console.log("change", change);
        if (change.type === "added") {
          let data = change.doc.data();
          pc.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
  };

  const handleHangupClick = async () => {
    closeConnection();
  };

  const closeConnection = () => {
    // close every old thing
    pc.close()
    dc?.close()
    if(hangupButton?.current) {
      hangupButton.current.disabled = true;
    }

    // setup new connection
    setUpConnection()
  }

  const setUpConnection = async () => {
    let remoteStream = new MediaStream();
    let localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

    pc = createPeer()
    dc = null

    pc.ontrack = (ev: RTCTrackEvent) => {
      ev.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track)
      })
    }

    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    })
    
    if (
      !clientVideo?.current ||
      !remoteVideo?.current ||
      !callButton?.current ||
      !answerButton?.current ||
      !webcamButton?.current
    ) {
      console.log("returned bc something involving refs");
      return;
    }

    clientVideo.current.srcObject = localStream;
    remoteVideo.current.srcObject = remoteStream;
    
    callButton.current.disabled = false;
    answerButton.current.disabled = false;
    webcamButton.current.disabled = true;
  }

  const createPeer = () => {
    const peer = new RTCPeerConnection(servers);
    
    peer.ondatachannel = (ev) => {
      dc = ev.channel

      dc.onclose = handleStatusChange
      dc.onopen = handleStatusChange
    }

    return peer;
  }

  const handleStatusChange = () => {
    const readyState = dc?.readyState;

    switch(readyState) {
      case 'closed':
        closeConnection();
        break;
      case 'open':
        if (!hangupButton?.current || !callInput?.current || !CBButton?.current) break;
        hangupButton.current.disabled = false;
        CBButton.current.disabled = true;
        callInput.current.value = ''
        break;
    }
    console.log('[Data Channel] Status : ', readyState)
  }

  const handleCBButtonClick = () => {
    if(!callInput?.current) return;
    navigator.clipboard.writeText(callInput.current.value)
  }

  return (
    <>
      <h1>Zoom Clone</h1>
      <h2>1. Start your Webcam</h2>
      <div class="videos">
        <span>
          <h3>Local Stream</h3>
          <video id="clientVideo" className="video" ref={clientVideo} autoPlay playsInline muted></video>
        </span>
        <span>
          <h3>Remote Stream</h3>
          <video id="remoteVideo" className="video" ref={remoteVideo} autoPlay playsInline></video>
        </span>
      </div>

      <button id="webcamButton" onClick={handleWebcamClick} ref={webcamButton}>
        Start webcam
      </button>
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
