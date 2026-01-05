import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Button, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { auth } from "../firebase"; // same pattern as connect-devices

const API_URL = "https://eir-backend-493785333909.us-central1.run.app";

function yyyymmddInTZ(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function SymptomsScreen() {
  const params = useLocalSearchParams<{ name?: string; date?: string }>();
  const name = params.name || "";
  const router = useRouter();

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const defaultDate = useMemo(() => yyyymmddInTZ(tz), [tz]);
  const date = (params.date as string) || defaultDate;

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [symptomsPayload, setSymptomsPayload] = useState<any>(null);
  
  function SummaryRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
      {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
    </View>
  );
}




  const loadFitbitSymptoms = async () => {
    try {
      setLoading(true);
      setStatus("Loading Fitbit symptom indicators...");
      setSymptomsPayload(null);

      const user = auth.currentUser;
      if (!user) {
        setStatus("Not signed in. Please sign in first.");
        setLoading(false);
        return;
      }

      const idToken = await user.getIdToken(true);

      const res = await fetch(
        `${API_URL}/fitbit/symptoms?date=${encodeURIComponent(date)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const json = await res.json();
      if (!res.ok) {
        setStatus(`Error loading symptoms: ${json?.error || res.status}`);
        setLoading(false);
        return;
      }

      setSymptomsPayload(json);
      setStatus("Loaded ✅");
    } catch (e: any) {
      setStatus("Error loading symptoms: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFitbitSymptoms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const indicators = symptomsPayload?.indicators ?? symptomsPayload?.result ?? null;
  const hotFlashCount = indicators?.indicators?.hot_flash_events?.length
  ?? indicators?.hot_flash_events?.length
  ?? 0;

const nightSweatsFlag = indicators?.indicators?.night_sweats?.flag
  ?? indicators?.night_sweats?.flag
  ?? false;

const nightSweatsScore = indicators?.indicators?.night_sweats?.score
  ?? indicators?.night_sweats?.score
  ?? 0;

const sleepDisruptionFlag = indicators?.indicators?.sleep_disruption?.flag
  ?? indicators?.sleep_disruption?.flag
  ?? false;

const sleepDisruptionScore = indicators?.indicators?.sleep_disruption?.score
  ?? indicators?.sleep_disruption?.score
  ?? 0;

const menopauseSummary =
  indicators?.indicators?.menopauseSummary ??
  indicators?.menopauseSummary ??
  null;

function levelFromScore(score: number) {
  if (score >= 0.75) return "High";
  if (score >= 0.4) return "Moderate";
  if (score > 0) return "Low";
  return "None";
}




  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Fitbit Symptom Insights</Text>
      <Text style={styles.subtitle}>
        Hi {name || "there"} — Date: {date} (TZ: {tz})
      </Text>

      <View style={{ marginTop: 10 }}>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <Button title="Refresh" onPress={loadFitbitSymptoms} />
        )}
      </View>

      <Text style={styles.status}>{status}</Text>

      <View style={styles.section}>
  <Text style={styles.sectionTitle}>Menopause Summary (from Fitbit)</Text>

  {indicators ? (
    <>
      <SummaryRow
        label="Hot flashes"
        value={`${hotFlashCount}`}
        sub="Detected from HR spikes + low steps"
      />

      <SummaryRow
        label="Night sweats"
        value={`${nightSweatsFlag ? "Yes" : "No"} • ${levelFromScore(nightSweatsScore)}`}
        sub={`Score: ${Math.round(nightSweatsScore * 100)}%`}
      />

      <SummaryRow
        label="Sleep disruption"
        value={`${sleepDisruptionFlag ? "Yes" : "No"} • ${levelFromScore(sleepDisruptionScore)}`}
        sub={`Score: ${Math.round(sleepDisruptionScore * 100)}%`}
      />
{menopauseSummary ? (
  <>
    <SummaryRow
      label="Hot flashes"
      value={`${menopauseSummary.hotFlashes.count} • ${menopauseSummary.hotFlashes.severity}`}
      sub={
        menopauseSummary.hotFlashes.sampleTimes?.length
          ? `Examples: ${menopauseSummary.hotFlashes.sampleTimes.join(", ")}`
          : "No events detected"
      }
    />

    <SummaryRow
      label="Night sweats"
      value={`${menopauseSummary.nightSweats.count} • ${menopauseSummary.nightSweats.severity}`}
      sub={
        menopauseSummary.nightSweats.sampleTimes?.length
          ? `Examples: ${menopauseSummary.nightSweats.sampleTimes.join(", ")}`
          : "No night events detected"
      }
    />

    <SummaryRow
      label="Sleep disruption"
      value={`${menopauseSummary.sleepDisruption.severity}`}
      sub={
        menopauseSummary.sleepDisruption.reason
          ? menopauseSummary.sleepDisruption.reason
          : "Based on night-time heart rate patterns"
      }
    />
  </>
) : (
  <>
    <Text style={styles.rawTitle}>Raw indicators (debug):</Text>
    <Text style={styles.raw}>{JSON.stringify(indicators, null, 2)}</Text>
  </>
)}

      
    </>
  ) : (
    <Text style={styles.placeholder}>
      No indicators returned yet. (Try “Fetch Fitbit data” first, then come back.)
    </Text>
  )}
</View>


      <View style={{ marginTop: 20 }}>
        <Button
          title="Back to Connect Devices"
          onPress={() =>
            router.push({
              pathname: "/connect-devices",
              params: { name },
            })
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: "700", marginBottom: 6 },
  subtitle: { fontSize: 14, marginBottom: 10, color: "#333" },
  status: { marginTop: 12, color: "gray" },
  section: {
    marginTop: 18,
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
  },
  sectionTitle: { fontWeight: "700", marginBottom: 8 },
  placeholder: { color: "#666" },
  rawTitle: { marginTop: 10, fontWeight: "600" },
  raw: {
    marginTop: 6,
    fontFamily: "monospace",
    fontSize: 12,
    color: "#222",
  },
  row: {
  paddingVertical: 10,
  borderBottomWidth: 1,
  borderColor: "#eee",
},
rowLabel: {
  fontWeight: "700",
  fontSize: 15,
},
rowValue: {
  marginTop: 2,
  fontSize: 15,
},
rowSub: {
  marginTop: 2,
  fontSize: 12,
  color: "#666",
},

});
