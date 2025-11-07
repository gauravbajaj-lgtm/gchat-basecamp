import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const {
  BASECAMP_ACCOUNT_ID,
  BASECAMP_PROJECT_ID,
  BASECAMP_LIST_ID,
  BASECAMP_ACCESS_TOKEN,
  USER_AGENT,
  PORT,
} = process.env;

let cachedUsers = [];
async function loadBasecampUsers() {
  if (cachedUsers.length) return cachedUsers;
  const url = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}/projects/${BASECAMP_PROJECT_ID}/people.json`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${BASECAMP_ACCESS_TOKEN}` },
  });
  cachedUsers = response.data;
  console.log("👥 Loaded Basecamp Users:");
  cachedUsers.forEach((u) => console.log(`   • ${u.name} (${u.id})`));
  return cachedUsers;
}

function parseTaskInput(message) {
  const dateMatch = message.match(/\b\d{4}-\d{2}-\d{2}\b/);
  const due_on = dateMatch ? dateMatch[0] : new Date().toISOString().split("T")[0];
  const notesMatch = message.match(/\bnotes?-\s*(.+?)(?=\s*(?:assigned to-|to-|\b\d{4}-\d{2}-\d{2}\b|$))/i);
  const notes = notesMatch ? notesMatch[1].trim() : "";
  const assigneeMatch = message.match(/(?:assigned to-|to-)\s*([A-Za-z,\s]+)/i);
  const assigneeName = assigneeMatch ? assigneeMatch[1].trim() : null;
  let title = "";
  if (/\bnotes?-/i.test(message)) {
    title = message.split(/\bnotes?-/i)[0].trim();
  } else if (/(?:assigned to-|to-)/i.test(message)) {
    title = message.split(/(?:assigned to-|to-)/i)[0].trim();
  } else {
    title = message.trim();
  }
  title = title.replace(/\b\d{4}-\d{2}-\d{2}\b/, "").trim();
  return { title, notes, assigneeName, due_on };
}

function getAssigneeIds(assigneeName, users) {
  if (!assigneeName) return [];
  const nameParts = assigneeName
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n);
  const assigneeIds = [];
  nameParts.forEach((namePart) => {
    const lowName = namePart.toLowerCase();
    const match = users.find((u) => {
      const userName = u.name.toLowerCase();
      return userName.includes(lowName) || userName.split(/\s+/).some((part) => part === lowName);
    });
    if (match) {
      assigneeIds.push(match.id);
      console.log(`✅ Found assignee for "${namePart}": ${match.name} (${match.id})`);
    } else {
      console.log(`⚠️ No matching assignee found for "${namePart}"`);
    }
  });
  return assigneeIds;
}

async function createBasecampCard(taskInfo) {
  const url = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}/buckets/${BASECAMP_PROJECT_ID}/card_tables/lists/${BASECAMP_LIST_ID}/cards.json`;
  const cardPayload = {
    title: taskInfo.title,
    content: taskInfo.notes,
    due_on: taskInfo.due_on,
  };
  const response = await axios.post(url, cardPayload, {
    headers: {
      Authorization: `Bearer ${BASECAMP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
  });
  console.log(`✅ Card Created: ${response.data.title} (ID: ${response.data.id})`);
  return response.data;
}

async function updateBasecampCard(cardId, taskInfo) {
  if (!taskInfo.assigneeIds?.length) return;
  const url = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}/buckets/${BASECAMP_PROJECT_ID}/card_tables/cards/${cardId}.json`;
  const updateBody = {
    assignee_ids: taskInfo.assigneeIds,
    due_on: taskInfo.due_on,
  };
  const response = await axios.patch(url, updateBody, {
    headers: {
      Authorization: `Bearer ${BASECAMP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
  });
  console.log(`✅ Card Updated with Assignees: ${response.data.title} (ID: ${response.data.id})`);
}

app.post("/google-chat-webhook", async (req, res) => {
  try {
    const payload = req.body;
    const messageData = payload?.chat?.messagePayload?.message || {};
    const sender = messageData?.sender || {};
    const space = messageData?.space || {};
    const messageText = messageData.text || "No message text";
    const { title, notes, due_on, assigneeName } = parseTaskInput(messageText);
    const users = await loadBasecampUsers();
    const assigneeIds = getAssigneeIds(assigneeName, users);

    const taskInfo = {
      title,
      notes,
      due_on,
      assigneeIds,
      senderName: sender.displayName || "Unknown Sender",
      senderEmail: sender.email || "Unknown Email",
      chatSpaceUrl: space.spaceUri || "N/A",
      messageTime: messageData.createTime || new Date().toISOString(),
    };
    console.log("🧾 Extracted Task Info:");
    console.log(JSON.stringify(taskInfo, null, 2));

    res.status(200).json({
      text: `✅ Task received from ${taskInfo.senderName}. Creating Basecamp card...`,
    });
    const card = await createBasecampCard(taskInfo);
    await updateBasecampCard(card.id, taskInfo);
  } catch (err) {
    console.error("❌ Error Handling Webhook or Basecamp API:");
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/", (req, res) =>
  res.send("✅ Server is running and ready for Google Chat → Basecamp integration!")
);

const port = PORT || 3000;
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));