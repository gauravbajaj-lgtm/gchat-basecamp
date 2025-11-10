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

const PROJECT_TO_LIST_ID = {
  "case study : deck + website":    "9120546407",
  "blogs: website":                 "9110129241",
  "new website":                    "9029767677",
  "truva":                          "9001050258",
  "project attonomous":             "8699666732",
  "amp template":                   "8662227827",
  "apparel - group":                "8587548781",
  "jockey & speedo - moengage":     "8545140731",
  "levi's - clevertap":             "8418705199",
  "akasa airlines":                 "7891669952",
  "content for attributics":        "7577004160",
  "attributics":                    "6935986330",
  "learning track & certifications":"6859333025",
  "unicef":                         "7161225064",
};

let cachedProjects = [];
async function loadBasecampProjects() {
  if (cachedProjects.length) return cachedProjects;
  const url = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}/projects.json`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${BASECAMP_ACCESS_TOKEN}` },
  });
  cachedProjects = response.data;
  console.log("📁 Loaded Basecamp Projects:");
  cachedProjects.forEach((p) => console.log(`   • ${p.name} (${p.id})`));
  return cachedProjects;
}

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
  const projectMatch = message.match(/\bp-\s*([A-Za-z0-9\s]+)/i);
  const projectName = projectMatch ? projectMatch[1].trim() : null;
  return { title, notes, assigneeName, due_on, projectName };
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

async function createBasecampCard(taskInfo, projectId, listId) {
  const url = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}/buckets/${projectId}/card_tables/lists/${listId}/cards.json`;
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
  console.log(`✅ Card Created in Project ${projectId}: ${response.data.title} (ID: ${response.data.id})`);
  return response.data;
}

async function updateBasecampCard(cardId, taskInfo, projectId) {
  if (!taskInfo.assigneeIds?.length) return;
  const url = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}/buckets/${projectId}/card_tables/cards/${cardId}.json`;
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
  console.log(`✅ Card Updated in Project ${projectId}: ${response.data.title} (ID: ${response.data.id})`);
}

function sanitizeMessageText(text) {
  if (!text) return "";
  return text
    .replace(/@\s*basecamp\s*task\s*bot/gi, "") 
    .replace(/<@[^>]+>/g, "")
    .trim();
}

app.post("/google-chat-webhook", async (req, res) => {
  try {
    const payload = req.body;
    const messageData = payload?.chat?.messagePayload?.message || {};
    const sender = messageData?.sender || {};
    const space = messageData?.space || {};
    let messageText = messageData.text || "No message text";
    messageText = sanitizeMessageText(messageText);
    const { title, notes, due_on, assigneeName, projectName } = parseTaskInput(messageText);
    const users = await loadBasecampUsers();
    const assigneeIds = getAssigneeIds(assigneeName, users);

    let projectId = BASECAMP_PROJECT_ID;
    let listId = BASECAMP_LIST_ID;
    if (projectName) {
     const projects = await loadBasecampProjects();
     const match = projects.find((p) =>p.name.toLowerCase().includes(projectName.toLowerCase()));
      if (match) {
        const mappedListId = PROJECT_TO_LIST_ID[match.name.toLowerCase()];
        console.log(`✅ Found matching project for "${projectName}": ${match.name} (${match.id})`);
        if (mappedListId) {
          listId = mappedListId;
          projectId = match.id;
          console.log(`✅ Using mapped list ID ${listId} for project "${match.name}".`);
        } else {
          console.log(`⚠️ No specific list ID mapped for project "${match.name}". Using default list ID.`);
        }
      } else {
        console.log(`⚠️ No matching project for "${projectName}". Using default project ID.`);
      }
    }

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

    const card = await createBasecampCard(taskInfo, projectId, listId);
    await updateBasecampCard(card.id, taskInfo, projectId);
    return res.status(200).json({
      text: `✅ Task successfully created in Basecamp project! (${taskInfo.title})`,
    });
  } catch (err) {
    console.error("❌ Error Handling Webhook or Basecamp API:");
    console.error(err.response?.data || err.message);
    if (!res.headersSent) {
      res.status(500).json({
        text: `❌ Failed to create Basecamp card. ${err.response?.data?.error || err.message}`,
      });
    }
  }
});

app.get("/", (req, res) =>
  res.send("✅ Server is running and ready for Google Chat → Basecamp integration!")
);

const port = PORT || 3000;
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));