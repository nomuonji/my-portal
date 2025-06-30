const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

exports.getFeatureRequests = functions.https.onRequest(async (req, res) => {
  // CORS対応
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    // Send response to OPTIONS requests
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    res.status(204).send("");
    return;
  }

  try {
    const db = admin.firestore();
    const featureRequestsRef = db.collection("featureRequests");

    // 'todo' または 'in_progress' のタスクをフィルタリング
    const snapshot = await featureRequestsRef
        .where("status", "in", ["todo", "in_progress"])
        .orderBy("priority", "desc") // high -> medium -> low の順にソート
        .orderBy("createdAt", "asc") // 同じ優先度の場合は作成日時が古い順
        .get();

    const requests = [];
    snapshot.forEach((doc) => {
      requests.push({id: doc.id, ...doc.data()});
    });

    res.status(200).json(requests);
  } catch (error) {
    console.error("Error fetching feature requests:", error);
    res.status(500).send("Error fetching feature requests.");
  }
});

exports.getFeatureRequests = functions.https.onRequest(async (req, res) => {
  // CORS対応
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    // Send response to OPTIONS requests
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    res.status(204).send("");
    return;
  }

  try {
    const db = admin.firestore();
    const featureRequestsRef = db.collection("featureRequests");

    // 'todo' または 'in_progress' のタスクをフィルタリング
    const snapshot = await featureRequestsRef
        .where("status", "in", ["todo", "in_progress"])
        .orderBy("priority", "desc") // high -> medium -> low の順にソート
        .orderBy("createdAt", "asc") // 同じ優先度の場合は作成日時が古い順
        .get();

    const requests = [];
    snapshot.forEach((doc) => {
      requests.push({id: doc.id, ...doc.data()});
    });

    res.status(200).json(requests);
  } catch (error) {
    console.error("Error fetching feature requests:", error);
    res.status(500).send("Error fetching feature requests.");
  }
});
