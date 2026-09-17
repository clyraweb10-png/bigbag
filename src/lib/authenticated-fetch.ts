"use client";

import { getFirebaseAuth } from "./firebase-client";

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const user = getFirebaseAuth().currentUser;
  if (user) {
    headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
  }
  return fetch(input, { ...init, headers });
}
