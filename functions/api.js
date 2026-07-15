import handler from "../netlify/functions/api.mjs";

export async function onRequest(context) {
  return handler(context.request, context.env);
}
