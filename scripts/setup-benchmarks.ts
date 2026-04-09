#!/usr/bin/env bun
/**
 * @file scripts/setup-benchmarks.ts
 * @description Sets up relational collections and seeds data for GraphQL benchmarking using HTTP API.
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4173";

async function main() {
  console.log(`🚀 Starting relational setup via API at ${API_BASE_URL}...`);

  // 1. Login to get cookie
  console.log("🔐 Logging in as admin...");
  const loginRes = await fetch(`${API_BASE_URL}/api/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@example.com",
      password: "Admin123!",
    }),
  });

  if (!loginRes.ok) {
    console.error("❌ Login failed. Ensure server is running and admin user exists.");
    process.exit(1);
  }

  const cookie = loginRes.headers.get("set-cookie") || "";
  console.log("✅ Logged in successfully.");

  const headers = {
    "Content-Type": "application/json",
    Cookie: cookie,
  };

  // 2. Create/Update Collections via content-structure API
  console.log("📂 Setting up 'Authors' and 'Posts' collections...");

  // UUIDs for collections
  const AUTHORS_ID = "00000000000000000000000000000001";
  const POSTS_ID = "00000000000000000000000000000002";

  const setupCollectionsRes = await fetch(`${API_BASE_URL}/api/content-structure`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "updateContentStructure",
      items: [
        {
          type: "create",
          node: {
            _id: AUTHORS_ID,
            path: "Authors",
            name: "Authors",
            nodeType: "collection",
            status: "publish",
            order: 1,
            icon: "mdi:account-details",
            collectionDef: {
              _id: AUTHORS_ID,
              name: "Authors",
              fields: [
                { label: "Name", widget: "Input", required: true },
                { label: "Bio", widget: "Input" },
                {
                  label: "Posts",
                  widget: "Relation",
                  collection: "Posts",
                  multiple: true,
                },
              ],
              permissions: { public: { read: true } },
            },
          },
        },
        {
          type: "create",
          node: {
            _id: POSTS_ID,
            path: "Posts",
            name: "Posts",
            nodeType: "collection",
            status: "publish",
            order: 2,
            icon: "mdi:post",
            collectionDef: {
              _id: POSTS_ID,
              name: "Posts",
              fields: [
                { label: "Title", widget: "Input", required: true },
                {
                  label: "Author",
                  widget: "Relation",
                  collection: "Authors",
                  multiple: false,
                },
              ],
              permissions: { public: { read: true } },
            },
          },
        },
      ],
    }),
  });

  const setupText = await setupCollectionsRes.text();
  console.log(`📡 Setup collections response [${setupCollectionsRes.status}]: ${setupText}`);

  // Wait a moment for reactivity to settle (optional but safer)
  await new Promise((r) => setTimeout(r, 500));

  // 5. Seed Data
  console.log("🌱 Seeding relational data...");

  // Seed Authors
  const authorIds = [];
  for (let i = 1; i <= 10; i++) {
    const res = await fetch(`${API_BASE_URL}/api/collections/${AUTHORS_ID}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        Name: `Author ${i}`,
        Bio: `Bio for author ${i}`,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      authorIds.push(data.data._id);
      console.log(`✅ Created author ${i}: ${data.data._id}`);
    } else {
      const text = await res.text();
      console.error(`❌ Failed to create author ${i}: ${res.status} ${text}`);
    }
  }
  console.log(`✅ Created ${authorIds.length} authors.`);

  // Seed Posts
  let postCount = 0;
  for (const authorId of authorIds) {
    for (let j = 1; j <= 5; j++) {
      const res = await fetch(`${API_BASE_URL}/api/collections/${POSTS_ID}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          Title: `Post ${j} by ${authorId}`,
          Author: authorId,
        }),
      });
      if (res.ok) postCount++;
    }
  }
  console.log(`✅ Created ${postCount} posts.`);

  console.log("🎉 Relational benchmark data setup complete!");
  process.exit(0);
}

main();
