const { MongoClient, ServerApiVersion, ObjectID } = require('mongodb');
const uri = process.env.ATLAS_URI;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

var _db;
async function getDb() {
    if (!_db)
        {
        await client.connect();
        _db = await client.db("rpsroyale");
        }
    return _db;
    }

async function giveEveryoneActionPoints(points)
    {
    let db = await getDb();
    let collection = db.collection("users");
    let operation = { $inc: { actionpoints: points } };
    collection.updateMany({}, operation, async function (err,result) {
        let ts = new Date().toLocaleDateString('en-us', { month: "short", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", timeZone: 'America/New_York'});
        db.collection('log').insertOne( { user: 'cron', timestamp: Date.now(), message: "gave everybody action points"}, async function (err,result) {
            await client.close();
            });
        });
    }

giveEveryoneActionPoints(2);
