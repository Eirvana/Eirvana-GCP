import React, { useEffect, useState } from "react";
import { View, Text, Button, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { getAuth } from "firebase/auth";

const API_URL = "https://eir-backend-493785333909.us-central1.run.app";

// DEV ONLY: replace with your admin trigger token for testing.
// Do NOT ship this value in production builds.
const ADMIN_TRIGGER_TOKEN = "PASTE_ADMIN_TOKEN_HERE";

export default function ConnectDevicesScreen() {
  const params = useLocalSearchParams<{ userId?: string; name?: string }>();
  const userId = params.userId || "demo-user-1";
  const name = params.name || "";

  const [status, setStatus] = useState("");
  const [fitbitConnected, setFitbitConnected] = useState(false);

  const checkFitbitStatus = async () => {
    try {
      const res = await fetch(
        `${API_URL}/fitbit/status?userId=${encodeURIComponent(
          String(userId)
        )}`
      );
      const data = await res.json();
      setFitbitConnected(!!data.connected);
      if (data.connected) {
        setStatus("Fitbit is connected ✅");
      } else {
        setStatus("Fitbit not connected");
      }
    } catch (e: any) {
      console.log(e);
      setStatus("Error checking Fitbit status");
    }
  };

  useEffect(() => {
    checkFitbitStatus();
  }, []);

  const connectFitbit = async () => {
    try {
      setStatus("Opening Fitbit...");
      const res = await fetch(
        `${API_URL}/fitbit/auth-url?userId=${encodeURIComponent(
          String(userId)
        )}`
      );
      const data = await res.json();
      if (!data.url) {
        setStatus("Failed to get Fitbit URL");
        return;
      }
      await WebBrowser.openBrowserAsync(data.url);
      setStatus(
        "Fitbit page opened. Complete login, then return here and tap 'Check connection'."
      );
    } catch (e: any) {
      console.log(e);
      setStatus("Error starting Fitbit connect: " + e.message);
    }
  };

  const connectOura = () => {
    setStatus("Oura integration coming soon.");
  };


// inside your component, replace the dev-token trigger with this:


const triggerFetchIntraday = async () => {
  try {
    setStatus("Triggering intraday fetch...");
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
      setStatus("Not signed in. Please sign in.");
      return;
    }
    // getIdToken(true) forces refresh so claims are current
    const idToken = await user.getIdToken(true);

    const res = await fetch(`${API_URL}/fitbit/fetch-intraday`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: user.uid })
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus("Trigger failed: " + (data?.error || res.status));
    } else {
      setStatus("Fetch triggered");
    }
  } catch (err:any) {
    console.error(err);
    setStatus("Network error triggering fetch");
  }
};

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hi {name || "there"} 👋</Text>
      <Text style={styles.subtitle}>
        Do you want to connect your wearables now?
      </Text>

      <View style={styles.buttonWrapper}>
        <Button
          title={fitbitConnected ? "Fitbit connected ✅" : "Connect Fitbit"}
          onPress={connectFitbit}
        />
      </View>

      <View style={styles.buttonWrapper}>
        <Button title="Check Fitbit connection" onPress={checkFitbitStatus} />
      </View>

      {/* Dev-only: trigger intraday fetch. Remove before shipping. */}
      <View style={styles.buttonWrapper}>
        <Button
          title="Trigger Fitbit Intraday Fetch (DEV)"
          onPress={triggerFetchIntraday}
        />
      </View>

      <View style={styles.buttonWrapper}>
        <Button title="Connect Oura (coming soon)" onPress={connectOura} />
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Text style={styles.note}>
        You can always connect devices later in Settings.
      </Text>
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