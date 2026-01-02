
// Client-only Firebase init. Avoid top-level imports that run in Node (SSR/dev server).
// Exports `auth` which is null on server and a Firebase Auth instance on client.

let auth: any = null;
let app: any = null;

if (typeof window !== "undefined") {
  // Run the RN crypto polyfill and initialize Firebase only in the browser/native runtime.
  // Use require() so bundlers don't execute these in the Node dev server.
  require("react-native-get-random-values");

  const { initializeApp } = require("firebase/app");
  const { getAuth } = require("firebase/auth");

  const firebaseConfig = {
    apiKey: "AIzaSyDC9k25S19lPeq-YLUb4AEvktSG--QP4rs",
	authDomain: "eirvanamobileapp.firebaseapp.com",
	projectId: "eirvanamobileapp",
	storageBucket: "eirvanamobileapp.firebasestorage.app",
	messagingSenderId: "493785333909",
	appId: "1:493785333909:web:b86c5b4d6db10e17195b9c",
	measurementId: "G-6CB5W23P66"
  };

  // idempotent init if needed
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
  } catch (err) {
    // In some HMR flows initializeApp may be called multiple times — ignore if already initialized
    // (firebase v9 modular throws if double-initialized)
    console.warn("Firebase init warning:", err && err.code ? err.code : err);
  }
}

export { auth };
export default app;