const API_URL = https://eir-backend-493785333909.us-central1.run.app";

export async function api(path: string, method = "GET", body?: any) {
  const res = await fetch(API_URL + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  return res.json();
}
