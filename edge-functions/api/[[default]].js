import { handleApiRequest } from "../../server/app.js";

export default async function onRequest(context) {
  return handleApiRequest(context);
}
