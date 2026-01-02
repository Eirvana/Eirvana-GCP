import React, { useEffect, useState } from "react";
import { View, Text, Button, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";

const API_URL = "https://eir-backend-493785333909.us-central1.run.app";

type Summary = {
  date: string;
  steps: number;
  calories: number;
  sleepMinutes: number;
};

export default function ConnectDevicesScreen() {
  const params = useLocalSearchParams<{ userId?: string; name?: string }>();
  const userId = params.userId || "demo-user-1";
  const name = params.name || "";
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [fitbitConnected, setFitbitConnected] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

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
      }
    } catch (e: any) {
      console.log(e);
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
        "Fitbit page opened. Complete login, then return here and tap 'Check Fitbit connection'."
      );
    } catch (e: any) {
      console.log(e);
      setStatus("Error starting Fitbit connect: " + e.message);
    }
  };

    const loadTodaySummary = async () => {
    try {
      setStatus("Loading today's Fitbit data...");

      // Build local date YYYY-MM-DD
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const res = await fetch(
        `${API_URL}/fitbit/daily-summary?userId=${encodeURIComponent(
          String(userId)
        )}&date=${dateStr}`
      );
      const data = await res.json();
      if (data.error) {
        setStatus("Error loading Fitbit data: " + data.error);
        return;
      }
      setSummary(data);
      setStatus(`Loaded Fitbit data for ${data.date} ✅`);
    } catch (e: any) {
      console.log(e);
      setStatus("Error loading Fitbit data: " + e.message);
    }
  };


  const connectOura = () => {
    setStatus("Oura integration coming soon.");
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

      {fitbitConnected && (
        <View style={styles.buttonWrapper}>
          <Button
            title="Load today's Fitbit data"
            onPress={loadTodaySummary}
          />
        </View>
      )}
		
	  {fitbitConnected && (
        <View style={styles.buttonWrapper}>
          <Button
            title="View today's dashboard"
            onPress={() =>
              router.push({
                pathname: "/dashboard",
                params: { userId, name },
              })
            }
          />
        </View>
      )}
	  
	  <View style={styles.buttonWrapper}>
        <Button
          title="Record today's symptoms"
          onPress={() =>
            router.push({
              pathname: "/symptoms",
              params: { userId, name },
            })
          }
        />
      </View>
	  
      <View style={styles.buttonWrapper}>
        <Button title="Connect Oura (coming soon)" onPress={connectOura} />
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      {summary && (
        <View style={styles.summaryBox}>
          <Text style={styles.summaryTitle}>
            Fitbit summary for {summary.date}
          </Text>
          <Text>Steps: {summary.steps}</Text>
          <Text>Calories: {summary.calories}</Text>
          <Text>Sleep: {summary.sleepMinutes} minutes</Text>
        </View>
      )}

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
  summaryBox: {
    marginTop: 24,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  summaryTitle: { fontWeight: "700", marginBottom: 8 },
});
