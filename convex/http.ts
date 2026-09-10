import { httpRouter } from "convex/server";
import { verify, receive } from "./webhook";

const http = httpRouter();

http.route({
  path: "/webhook",
  method: "GET",
  handler: verify,
});

http.route({
  path: "/webhook",
  method: "POST",
  handler: receive,
});

export default http;
