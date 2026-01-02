import React, { useEffect, useState } from "react";
import { View, Text, Button, StyleSheet, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import { auth } from "../firebase"; // use the firebase.ts file you just added

const API_URL = "https://eir-backend-493785333909.us-central1.run.app"; // replace with your deployed backend URL

export default function ConnectDevicesScreen() {
  const params = useLocalSearchParams<{ name?: string }>();
  const name = params.name || "";

  const [status, setStatus] = useState("");
  const [fitbitConnected, setFitbitConnected] = useState(false);

  // Check connection using authenticated endpoint
  const checkFitbitStatus = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        setStatus("Not signed in");
        setFitbitConnected(false);
        return;
      }
      const idToken = await user.getIdToken(true);
      const res = await fetch(`${API_URL}/fitbit/status`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      setFitbitConnected(!!data.connected);
      setStatus(data.connected ? "Fitbit connected ✅" : "Fitbit not connected");
    } catch (e: any) {
      console.log(e);
      setStatus("Error checking Fitbit status");
      setFitbitConnected(false);
    }
  };

  useEffect(() => {
    // on mount, update connection state if signed in
    checkFitbitStatus();
  }, []);

  // Start Fitbit connect flow (backend will embed uid in state)
  const connectFitbit = async () => {
    try {
      setStatus("Opening Fitbit...");
      const user = auth.currentUser;
      if (!user) {
        Alert.alert("Sign in required", "Please sign in before connecting Fitbit.");
        setStatus("Not signed in");
        return;
      }
      const idToken = await user.getIdToken(true);
      const res = await fetch(`${API_URL}/fitbit/auth-url`, {
        method: "GET",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!data.url) {
        setStatus("Failed to get Fitbit URL");
        Alert.alert("Error", JSON.stringify(data));
        return;
      }
      // Open the Fitbit auth page in the system browser. Fitbit will redirect to your backend callback.
      await WebBrowser.openBrowserAsync(data.url);
      setStatus("Fitbit page opened; complete login in browser then return here and tap 'Check connection'.");
    } catch (e: any) {
      console.error("connectFitbit error", e);
      setStatus("Error starting Fitbit connect: " + (e?.message || String(e)));
    }
  };

  // Trigger a per-user intraday fetch (authenticated)
  const triggerFetchIntraday = async () => {
    try {
      setStatus("Triggering intraday fetch...");
      const user = auth.currentUser;
      if (!user) {
        setStatus("Not signed in");
        Alert.alert("Sign in required", "Please sign in to trigger fetch.");
        return;
      }
      const idToken = await user.getIdToken(true);
      const res = await fetch(`${API_URL}/fitbit/fetch-intraday`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: user.uid }), // backend verifies uid === caller
      });
      const data = await res.json();
      if (!res.ok) {
        console.log("Trigger fetch error:", data);
        setStatus("Trigger failed: " + (data?.error || res.status));
        Alert.alert("Trigger failed", JSON.stringify(data));
      } else {
        setStatus("Intraday fetch triggered");
        Alert.alert("Fetch triggered", JSON.stringify(data));
      }
    } catch (err: any) {
      console.error("Network error triggering fetch:", err);
      setStatus("Network error triggering fetch");
      Alert.alert("Network error", err.message || String(err));
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hi {name || "there"} 👋</Text>
      <Text style={styles.subtitle}>Do you want to connect your wearables now?</Text>

      <View style={styles.buttonWrapper}>
        <Button title={fitbitConnected ? "Fitbit connected ✅" : "Connect Fitbit"} onPress={connectFitbit} />
      </View>

      <View style={styles.buttonWrapper}>
        <Button title="Check Fitbit connection" onPress={checkFitbitStatus} />
      </View>

      <View style={styles.buttonWrapper}>
        <Button title="Trigger Fitbit Intraday Fetch" onPress={triggerFetchIntraday} />
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Text style={styles.note}>You can always connect devices later in Settings.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 26, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: 16, marginBottom: 24 },
  buttonWrapper: { marginVertical: 8 },
  status: { marginTop: 16, color: "gray" },
  note: { marginTop: 24, fontSize: 12, color: "gray" },
});