// js/firebase-config.js
import { initializeApp } from "firebase/app";
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDbMkfP-CFLkugdzYNEo2nx_daE36IR17Q",
  authDomain: "zonadecompost-4d754.firebaseapp.com",
  projectId: "zonadecompost-4d754",
  storageBucket: "zonadecompost-4d754.firebasestorage.app",
  messagingSenderId: "113533519094",
  appId: "1:113533519094:web:925c726bc882a51aa858d7"
};

const app = initializeApp(firebaseConfig);

// Inicializa Firestore con almacenamiento local persistente y soporte para múltiples pestañas
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

export { app, db };