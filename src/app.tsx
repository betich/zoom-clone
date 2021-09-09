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

let pc = new RTCPeerConnection(servers);

export function App() {
  const clientVideo = useRef<never | HTMLVideoElement>(null);
  const remoteVideo = useRef<never | HTMLVideoElement>(null);
  const callButton = useRef<never | HTMLButtonElement>(null);
  const answerButton = useRef<never | HTMLButtonElement>(null);
  const webcamButton = useRef<never | HTMLButtonElement>(null);
  const hangupButton = useRef<never | HTMLButtonElement>(null);
  const callInput = useRef<never | HTMLInputElement>(null);

  // 1. Setup media sources
  const handleWebcamClick = async () => {
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

    let localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    let remoteStream = new MediaStream();

    if (!localStream || !remoteStream) {
      console.log("returned bc something involving streams😁 ");
      return;
    }

    // Push tracks from local stream to peer connection
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    // Pull tracks from remote stream, add to video stream
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    };

    clientVideo.current.srcObject = localStream;

    remoteVideo.current.srcObject = remoteStream;

    callButton.current.disabled = false;
    answerButton.current.disabled = false;
    webcamButton.current.disabled = true;
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

    hangupButton.current.disabled = false;
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
    await pc.close();
  };

  return (
    <>
      <h1>Zoom Clone</h1>
      <h2>1. Start your Webcam</h2>
      <div class="videos">
        <span>
          <h3>Local Stream</h3>
          <video id="clientVideo" ref={clientVideo} autoPlay playsInline muted></video>
        </span>
        <span>
          <h3>Remote Stream</h3>
          <video id="remoteVideo" ref={remoteVideo} autoPlay playsInline></video>
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

      <h2>4. Hangup</h2>

      <button id="hangupButton" disabled ref={hangupButton} onClick={handleHangupClick}>
        Hangup
      </button>
    </>
  );
}
