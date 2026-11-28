import test from "node:test";
import assert from "node:assert/strict";
import {canReview, week, publicFeedback, reputation, quota, unread, membershipPanel} from "../src/community.js";
import {sendAIMessage, newAIConversation} from "../src/ai-room.js";

test("mutual reviews use the completion clock and count received ratings", () => {
  const entry = {rating: 5, text: "감사합니다"};
  const r = {status:"complete", completedAt:100, renterId:"a", lenderId:"b", feedback:{renter:entry}};
  assert.equal(canReview(r, "c", 101), false);
  assert.equal(canReview(r, "b", 100 + week - 1), true);
  assert.equal(canReview(r, "b", 100 + week), false);
  assert.deepEqual(publicFeedback(r, 101), {});
  assert.deepEqual(publicFeedback(r, 100 + week), {renter:entry});
  r.feedback.lender = {rating:4,text:"깔끔해요"};
  assert.deepEqual(reputation([r], "b"), {completed:1,reviews:[entry]});
});

test("unread counts only incoming unread messages", () => {
  assert.equal(unread([{sender:"a"}, {sender:"b",read:true}, {sender:"b"}, {sender:"c",read:false}], "a"), 2);
});

test("monthly balance and duplicate promotion controls", () => {
  const plan = {active:true,grants:{"2026-11":2},actions:[{type:"promote",month:"2026-11",target:"drill"}]};
  assert.equal(quota(plan, "2026-11"), 1);
  assert.equal(quota(plan, "2026-12"), null);
  assert.doesNotMatch(membershipPanel("u",plan,[{id:"drill",owner:"u",title:"드릴"}],[],"2026-11",String,false), /data-action="promote"/);
});

test("invalid recommendation IDs preserve the question for retry", async () => {
  const session = newAIConversation();
  session.draft = "영화 볼 물건 추천";
  assert.equal(await sendAIMessage(session, [{id:"projector"}], "2026-11-26", async () => ({text:"추천",item_ids:["made-up"]})), false);
  assert.equal(session.messages.length, 0);
  assert.equal(session.draft, "영화 볼 물건 추천");
});

test("model field placeholders cannot appear as a successful recommendation", async () => {
  const session = newAIConversation();
  session.draft = "영화";
  assert.equal(await sendAIMessage(session, [], "2026-11-26", async () => ({text:"item_ids[123]입니다",item_ids:[]})), false);
  assert.equal(session.messages.length, 0);
});
