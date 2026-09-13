// Cloudflare Pages Function for POST /api/book (the live site runs on Pages, which ignores wrangler.jsonc "main").
import { handleBook } from "../../worker/index.js";

export const onRequestPost = ({ request, env }) => handleBook(request, env);
