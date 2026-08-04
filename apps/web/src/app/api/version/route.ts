import { release } from "@formsentinel/config";
export function GET() {
  return Response.json(release());
}
