import { Room } from "@/features/room/Room";

export default async function VoyageRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <Room key={code} caseCode={code} />;
}
