// js/firebase-config.js
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCBbtC5JCgM2H6Gehwa2GepNBddxvqwzso",
  authDomain: "zonacompost-app.firebaseapp.com",
  projectId: "zonacompost-app",
  storageBucket: "zonacompost-app.firebasestorage.app",
  messagingSenderId: "956257073147",
  appId: "1:956257073147:web:6b6b12c59a1f24e86a3d5e"
};

const app = initializeApp(firebaseConfig);

// Inicializa Firestore con almacenamiento local persistente
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// Inicializa Authentication
const auth = getAuth(app);

export { app, db, auth };