import { initializeApp, getApps, getApp } from "firebase/app";

const firebaseConfig = {
  apiKey: "AIzaSyC484rn9n9_-txFpmjSp9dmCVzLws4bzrc",
  authDomain: "zoom-clone-lol.firebaseapp.com",
  projectId: "zoom-clone-lol",
  storageBucket: "zoom-clone-lol.appspot.com",
  messagingSenderId: "583459934566",
  appId: "1:583459934566:web:8eb796bd47fc63f10ab8a7",
};

export const initFirebase = () => {
  if (getApps().length !== 0) {
    return getApp();
  } else {
    return initializeApp(firebaseConfig);
  }
};
