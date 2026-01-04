import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";

import { auth } from "../../firebase"; // relative to app/(tabs)/index.tsx -> go up two levels to eir-mobile/firebase.ts

const API_URL = "https://eir-backend-493785333909.us-central1.run.app"; // replace with your backend URL if different

type SymptomEntry = {
  id: string;
  date: string;
  symptoms: {
    hotFlashes?: number;
    nightSweats?: number;
    sleepQuality?: number;
    mood?: number;
  };
  notes?: string;
};

type SymptomIndicators = {
  sleep_disruption?: { flag: boolean; score?: number; reason?: string };
  hot_flash_events?: Array<any>;
  night_sweats?: { flag: boolean; score?: number; reason?: string };
  fatigue_recovery?: { flag: boolean; score?: number; reason?: string };
  palpitations?: Array<any>;
  meta?: any;
};

export default function HomeScreen() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10)); // YYYY-MM-DD
  const [hotFlashes, setHotFlashes] = useState("0");
  const [nightSweats, setNightSweats] = useState("0");
  const [sleepQuality, setSleepQuality] = useState("5");
  const [mood, setMood] = useState("5");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState<SymptomEntry[] | any>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingIndicators, setLoadingIndicators] = useState(false);
  const [indicators, setIndicators] = useState<SymptomIndicators | null>(null);

  // Helper: get idToken for authenticated requests
  const getIdToken = async () => {
    const user = auth.currentUser;
    if (!user) return null;
    try {
      return await user.getIdToken(true);
    } catch (err) {
      console.warn("Failed to get idToken", err);
      return null;
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        setStatus("Sign in to load your history.");
        setHistory([]);
        setLoadingHistory(false);
        return;
      }

      const res = await fetch(`${API_URL}/symptoms?date=${encodeURIComponent(date)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn("Failed to load history:", res.status, text);
        setHistory([]);
        setStatus("Could not load history");
        setLoadingHistory(false);
        return;
      }

      const data = await res.json();
      // Normalize possible response shapes
      if (Array.isArray(data)) {
        setHistory(data);
      } else if (data && Array.isArray(data.entries)) {
        setHistory(data.entries);
      } else if (data && data.date && data.symptoms) {
        setHistory([data]);
      } else {
        setHistory([]);
      }
      setStatus("");
    } catch (e) {
      console.log("Error loading history", e);
      setHistory([]);
      setStatus("Error loading history");
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadIndicators = async (forDate?: string) => {
    setLoadingIndicators(true);
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        setStatus("Sign in to load indicators.");
        setIndicators(null);
        setLoadingIndicators(false);
        return;
      }
      const targetDate = forDate || date;
      const res = await fetch(`${API_URL}/fitbit/symptoms?date=${encodeURIComponent(targetDate)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
      });

      if (res.status === 404) {
        setIndicators(null);
        setStatus("No Fitbit indicators stored for that date.");
        setLoadingIndicators(false);
        return;
      }

      if (!res.ok) {
        const text = await res.text();
        console.warn("Failed to load indicators:", res.status, text);
        setStatus("Could not load indicators");
        setIndicators(null);
        setLoadingIndicators(false);
        return;
      }

      const json = await res.json();
      const payload = json.indicators || json;
      setIndicators(payload.indicators || payload);
      setStatus("");
    } catch (err) {
      console.error("Error loading indicators", err);
      setIndicators(null);
      setStatus("Error loading indicators");
    } finally {
      setLoadingIndicators(false);
    }
  };

  useEffect(() => {
    loadHistory();
    loadIndicators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadHistory();
    loadIndicators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const saveToday = async () => {
    try {
      setStatus("Saving...");
      const idToken = await getIdToken();
      if (!idToken) {
        Alert.alert("Sign in required", "Please sign in to save your symptoms.");
        setStatus("Sign in required");
        return;
      }

      const body = {
        date,
        symptoms: {
          hotFlashes: Number(hotFlashes),
          nightSweats: Number(nightSweats),
          sleepQuality: Number(sleepQuality),
          mood: Number(mood),
        },
        notes,
      };

      const res = await fetch(`${API_URL}/symptoms/today`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      setStatus("Saved!");
      setNotes("");
      await loadHistory();
      await loadIndicators();
    } catch (e: any) {
      console.log("Save error:", e);
      setStatus("Error saving: " + (e?.message || String(e)));
      Alert.alert("Save error", String(e?.message || e));
    }
  };

  const isHistoryArray = Array.isArray(history);

  // Optional: format event time (ISO or HH:MM:SS)
  const formatEventTime = (tsOrTimeStr?: string) => {
    if (!tsOrTimeStr) return "";
    try {
      if (tsOrTimeStr.includes("T")) {
        const d = new Date(tsOrTimeStr);
        return d.toLocaleString();
      } else {
        const [hh, mm, ss] = (tsOrTimeStr || "").split(":").map(Number);
        const d = new Date();
        d.setHours(hh || 0, mm || 0, ss || 0, 0);
        return d.toLocaleTimeString();
      }
    } catch {
      return tsOrTimeStr;
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Eirvana – Today's Symptoms</Text>

      <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
      <TextInput value={date} onChangeText={setDate} style={styles.input} />

      <Text style={styles.label}>Hot flashes (0–10)</Text>
      <TextInput
        value={hotFlashes}
        onChangeText={setHotFlashes}
        keyboardType="numeric"
        style={styles.input}
      />

      <Text style={styles.label}>Night sweats (0–10)</Text>
      <TextInput
        value={nightSweats}
        onChangeText={setNightSweats}
        keyboardType="numeric"
        style={styles.input}
      />

      <Text style={styles.label}>Sleep quality (0–10)</Text>
      <TextInput
        value={sleepQuality}
        onChangeText={setSleepQuality}
        keyboardType="numeric"
        style={styles.input}
      />

      <Text style={styles.label}>Mood (0–10)</Text>
      <TextInput value={mood} onChangeText={setMood} keyboardType="numeric" style={styles.input} />

      <Text style={styles.label}>Notes</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        style={[styles.input, styles.notesInput]}
        placeholder="Anything you want to remember about today?"
      />

      <View style={styles.buttonWrapper}>
        <Button title="Save today’s log" onPress={saveToday} />
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <View style={{ marginTop: 18 }}>
        <Text style={styles.subtitle}>Fitbit-derived indicators</Text>
        {loadingIndicators ? (
          <ActivityIndicator />
        ) : indicators ? (
          <View style={styles.card}>
            <Text style={styles.cardDate}>Date: {date}</Text>

            <Text>Sleep disruption: {indicators.sleep_disruption?.flag ? "Yes" : "No"} </Text>
            {indicators.sleep_disruption?.reason ? (
              <Text>Reason: {indicators.sleep_disruption.reason}</Text>
            ) : null}

            <Text>Night sweats: {indicators.night_sweats?.flag ? "Yes" : "No"}</Text>
            {indicators.night_sweats?.reason ? <Text>Reason: {indicators.night_sweats.reason}</Text> : null}

            <Text>
              Fatigue/recovery: {indicators.fatigue_recovery?.flag ? "Likely" : "Unlikely"}{" "}
              {indicators.fatigue_recovery?.reason ? `(${indicators.fatigue_recovery.reason})` : ""}
            </Text>

            <Text>Hot flash events: {(indicators.hot_flash_events || []).length}</Text>
            {(indicators.hot_flash_events || []).map((e: any, i: number) => (
              <Text key={`hf-${i}`}>• {formatEventTime(e.startTime || e.start)} — ΔHR {String(e.delta ?? e.peakHr ?? "-")}</Text>
            ))}

            <Text>Palpitations: {(indicators.palpitations || []).length}</Text>
            {(indicators.palpitations || []).map((p: any, i: number) => (
              <Text key={`p-${i}`}>• {formatEventTime(p.startTime || p.start)} — avg HR {String(p.avgHr ?? "-")}</Text>
            ))}

            <Text style={styles.rawTitle}>Raw indicator meta</Text>
            <Text style={styles.raw}>{JSON.stringify(indicators.meta || {}, null, 2)}</Text>
          </View>
        ) : (
          <View>
            <Text style={styles.placeholder}>No Fitbit indicators for this date.</Text>
            <View style={{ marginTop: 8 }}>
              <Button title="Reload indicators" onPress={() => loadIndicators(date)} />
            </View>
          </View>
        )}
      </View>

      <Text style={[styles.subtitle, { marginTop: 18 }]}>Recent entries</Text>

      {loadingHistory ? <ActivityIndicator /> : null}

      {isHistoryArray && history.length === 0 && <Text>No entries yet.</Text>}

      {isHistoryArray &&
        history.map((entry: SymptomEntry) => (
          <View key={entry.id} style={styles.card}>
            <Text style={styles.cardDate}>{entry.date}</Text>
            <Text>
              Hot flashes: {entry.symptoms.hotFlashes ?? "-"} | Night sweats: {entry.symptoms.nightSweats ?? "-"}
            </Text>
            <Text>
              Sleep: {entry.symptoms.sleepQuality ?? "-"} | Mood: {entry.symptoms.mood ?? "-"}
            </Text>
            {entry.notes ? <Text style={styles.cardNotes}>Notes: {entry.notes}</Text> : null}
          </View>
        ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 24,
    marginBottom: 8,
  },
  label: {
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  notesInput: {
    minHeight: 60,
  },
  buttonWrapper: {
    marginTop: 8,
  },
  status: {
    marginTop: 8,
    color: "gray",
  },
  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  cardDate: {
    fontWeight: "600",
    marginBottom: 4,
  },
  cardNotes: {
    marginTop: 4,
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