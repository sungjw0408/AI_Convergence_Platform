// 사전 문의 채팅방 관리

export function findInquiry(rooms, userId, partnerId) {
  return (rooms ?? []).find(room =>
    room.participants.length === 2 &&
    room.participants.includes(userId) &&
    room.participants.includes(partnerId)
  );
}

export function createInquiry(rooms, userId, partnerId) {
  if (!userId || !partnerId || userId === partnerId) {
    throw new Error("채팅 상대를 확인해 주세요.");
  }

  const existing = findInquiry(rooms, userId, partnerId);

  if (existing) return existing;

  const room = {
    id: "inquiry_" + crypto.randomUUID(),
    participants: [userId, partnerId].sort(),
    createdAt: Date.now()
  };

  rooms.push(room);

  return room;
}

export function inquiryPartner(room, userId) {
  if (!room?.participants.includes(userId)) {
    return null;
  }

  return room.participants.find(id => id !== userId);
}

export function isInquiryParty(room, userId) {
  return Boolean(room?.participants.includes(userId));
}