import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Button,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import { auth } from "../firebase"; // use the firebase.ts file you added

const API_URL = "https://eir-backend-493785333909.us-central1.run.app"; // replace with your deployed backend URL

export default function ConnectDevicesScreen() {
  const params = useLocalSearchParams<{ name?: string }>();
  const name = params.name || "";

  const [status, setStatus] = useState("");
  const [fitbitConnected, setFitbitConnected] = useState(false);
  const [loadingConnect, setLoadingConnect] = useState(false);
  const [loadingFetch, setLoadingFetch] = useState(false);
  const [fetchResult, setFetchResult] = useState<any>(null);
  const [daySummary, setDaySummary] = useState<any>(null);

  // Check connection using authenticated endpoint
  const checkFitbitStatus = async () => {
    try {
      setStatus("Checking Fitbit status...");
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
      setLoadingConnect(true);
      setStatus("Opening Fitbit...");
      const user = auth.currentUser;
      console.log("auth.currentUser:", user);

      if (!user) {
        Alert.alert("Sign in required", "Please sign in before connecting Fitbit.");
        setStatus("Not signed in");
        setLoadingConnect(false);
        return;
      }

      const idToken = await user.getIdToken(true);
      console.log("idToken (short):", idToken?.slice?.(0, 40));

      const res = await fetch(`${API_URL}/fitbit/auth-url`, {
        method: "GET",
        headers: { Authorization: `Bearer ${idToken}` },
      });

      const text = await res.text();
      console.log("fitbit/auth-url status:", res.status, "body:", text);

      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.warn("fitbit/auth-url returned non-JSON:", e);
      }

      if (!res.ok) {
        setStatus("Failed to get Fitbit URL");
        Alert.alert("Error", data?.error ? String(data.error) : text);
        setLoadingConnect(false);
        return;
      }

      if (!data?.url) {
        setStatus("Failed to get Fitbit URL");
        Alert.alert("Error", "Response missing url: " + text);
        setLoadingConnect(false);
        return;
      }

      await WebBrowser.openBrowserAsync(data.url);
      setStatus("Fitbit page opened; complete login in browser then return here and tap 'Check connection'.");
    } catch (e: any) {
      console.error("connectFitbit error", e);
      setStatus("Error starting Fitbit connect: " + (e?.message || String(e)));
    } finally {
      setLoadingConnect(false);
    }
  };

  // Trigger a per-user intraday fetch (authenticated) and then fetch day summary
// (file header omitted — replace only fetchFitbitData or use the full file below)

  // Trigger a per-user intraday fetch (authenticated) and then fetch day summary
  const fetchFitbitData = async () => {
    try {
      setLoadingFetch(true);
      setStatus("Triggering fetch...");
      setFetchResult(null);
      setDaySummary(null);

      const user = auth.currentUser;
      if (!user) {
        Alert.alert("Sign in required", "Please sign in before fetching Fitbit data.");
        setStatus("Not signed in");
        setLoadingFetch(false);
        return;
      }

      const idToken = await user.getIdToken(true);

      // Compute the user's local date (YYYY-MM-DD) using the device/browser local time
      const now = new Date();
      const localDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      console.log("Local date being requested:", localDateStr);

      // 1) Trigger backend fetch (this will attempt intraday then fallback to day),
      // send local date so backend fetches the correct day for the user.
      const fetchRes = await fetch(`${API_URL}/fitbit/fetch-intraday`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ date: localDateStr }),
      });

      const fetchJson = await fetchRes.json();
      console.log("fetch-intraday response:", fetchRes.status, fetchJson);
      if (!fetchRes.ok) {
        const errMsg = fetchJson?.error || JSON.stringify(fetchJson);
        setStatus("Fetch failed: " + errMsg);
        Alert.alert("Fetch failed", String(errMsg));
        setLoadingFetch(false);
        return;
      }

      setFetchResult(fetchJson.result || fetchJson);
      setStatus("Fetch complete — retrieving day summary...");

      // 2) Ask backend for a friendly day summary (activity + sleep) for the same date
      const dayRes = await fetch(`${API_URL}/fitbit/daily-summary?date=${encodeURIComponent(localDateStr)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
      });
      if (!dayRes.ok) {
        const text = await dayRes.text();
        console.warn("daily-summary failed:", dayRes.status, text);
        setStatus("Fetch completed, but could not get day summary");
        setLoadingFetch(false);
        return;
      }
	  
	  // after fetching data, show symptoms:
	const res = await fetch(`${API_URL}/fitbit/symptoms?date=${localDateStr}`, { headers: { Authorization: `Bearer ${idToken}` }});
	const json = await res.json();
	console.log('symptoms', json.indicators);

      const dayJson = await dayRes.json();
      setDaySummary(dayJson);
      setStatus("Data fetched and summary loaded.");
    } catch (e: any) {
      console.error("fetchFitbitData error", e);
      setStatus("Error fetching Fitbit data: " + (e?.message || String(e)));
      Alert.alert("Error", e?.message || String(e));
    } finally {
      setLoadingFetch(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Hi {name || "user"}</Text>
      <Text style={styles.status}>{status}</Text>

      <View style={styles.buttonRow}>
        <Button
          title={fitbitConnected ? "Fitbit connected" : "Connect Fitbit"}
          onPress={connectFitbit}
          disabled={loadingConnect}
        />
      </View>

      <View style={styles.buttonRow}>
        <Button title="Check connection" onPress={checkFitbitStatus} />
      </View>

      <View style={styles.buttonRow}>
        {loadingFetch ? (
          <ActivityIndicator />
        ) : (
          <Button
            title="Fetch Fitbit data (intraday → day fallback)"
            onPress={fetchFitbitData}
            disabled={!fitbitConnected}
          />
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Fetch result (summary)</Text>
        {fetchResult ? (
          <View>
            // insert/update in the Fetch result (summary) rendering block
			<Text>StoredDocId: {fetchResult?.storedDocId || "n/a"}</Text>
			<Text>Requested date: {fetchResult?.date || "n/a"}</Text>
			<Text>Intraday date used: {fetchResult?.resultSummary?.intradayDateUsed ?? fetchResult?.date ?? "n/a"}</Text>
			<Text>HasIntraday: {fetchResult?.resultSummary?.hasIntraday ? 'true' : 'false'}</Text>
			<Text>Intraday heart present: {fetchResult?.resultSummary?.intradayHasHeart ? 'true' : 'false'}</Text>
			<Text>Intraday steps present: {fetchResult?.resultSummary?.intradayHasSteps ? 'true' : 'false'}</Text>
			<Text>Day fetched: {fetchResult?.resultSummary?.dayFetched ? 'true' : 'false'}</Text>
          </View>
        ) : (
          <Text style={styles.placeholder}>No fetch result yet.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Day summary</Text>
        {daySummary ? (
          <View>
            <Text>Date: {daySummary?.date || "today"}</Text>
            <Text>Steps: {daySummary?.steps ?? daySummary?.summary?.steps ?? "n/a"}</Text>
            <Text>Calories: {daySummary?.calories ?? daySummary?.summary?.calories ?? "n/a"}</Text>
            <Text>Sleep minutes: {daySummary?.sleepMinutes ?? daySummary?.summary?.sleepMinutes ?? "n/a"}</Text>

            <Text style={styles.rawTitle}>Raw day summary:</Text>
            <Text style={styles.raw}>{JSON.stringify(daySummary, null, 2)}</Text>
          </View>
        ) : (
          <Text style={styles.placeholder}>No day summary loaded.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  heading: {
    fontSize: 22,
    marginBottom: 8,
  },
  status: {
    marginBottom: 12,
    color: "#333",
  },
  buttonRow: {
    marginVertical: 8,
  },
  section: {
    marginTop: 18,
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
  },
  sectionTitle: {
    fontWeight: "700",
    marginBottom: 8,
  },
  placeholder: {
    color: "#666",
  },
  rawTitle: {
    marginTop: 10,
    fontWeight: "600",
  },
  raw: {
    marginTop: 6,
    fontFamily: "monospace",
    fontSize: 12,
    color: "#222",
  },
});