import 'react-native-get-random-values';
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDC9k25S19lPeq-YLUb4AEvktSG--QP4rs",
  authDomain: "eirvanamobileapp.firebaseapp.com",
  projectId: "eirvanamobileapp",
  storageBucket: "eirvanamobileapp.firebasestorage.app",
  messagingSenderId: "493785333909",
  appId: "1:493785333909:web:b86c5b4d6db10e17195b9c",
  measurementId: "G-6CB5W23P66"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const auth = getAuth(app);
export default app;