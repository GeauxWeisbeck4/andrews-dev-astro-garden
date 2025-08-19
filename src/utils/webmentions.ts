import * as fs from "node:fs";
import { WEBMENTION_API_KEY } from "astro:env/server";
import type { WebmentionsCache, WebmentionsChildren, WebmentionsFeed } from "../types.ts";

const DOMAIN = import.meta.env.SITE;

const CACHE_DIR = ".data";
const filePath = `${CACHE_DIR}/webmentions.json`;
const validWebmentionTypes = ["like-of", "mention-of", "in-reply-to"];

const hostName = new URL(DOMAIN).hostname;

// Calls webmention.io api
async function fetchWebmentions(timeFrom: string | null, perPage = 1000) {
  if (!DOMAIN) {
    console.warn("No domain specified. Please set in astro.config.ts");
    return null;
  }

  if (!WEBMENTION_API_KEY) {
    console.warn("No webmention API key specified. Please set in astro.config.ts");
    return null;
  }

  let url = `https://webmention.io/api/mentions.jf2?domain=${hostName}&token=${WEBMENTION_API_KEY}&sort-dir=up&per-page=${perPage}`;

  if (timeFrom) url += `&since${timeFrom}`;

  const res = await fetch(url);

  if (res.ok) {
    const data = (await res.json()) as WebmentionsFeed;
    return data;
  }

  return null;
}

// Merge cached entries [a] with fresh webmentioons [b], merge by wm-id
function mergeWebmentions(a: WebmentionsCache, b: WebmentionsFeed): WebmentionsChildren[] {
  return Array.from(
    [...a.children, ...b.children]
      .reduce((map, obj) => map.set(obj["wm-id"], obj), new Map())
      .values(),
  );
}

// filter out WebmentionChildren
export function filterWebmentions(webmentions: WebmentionsChildren[]) {
  return webmentions.filter((webmention) => {
    // Make sure wm has a property to be sorted later on
    if (!validWebmentionTypes.includes(webmention["wm-property"])) return false;

    // make sure mention of or in-reply-to has text content
    if (webmention["wm-property"] === "mention-of" || webmention["wm-property"] === "in-reply-to") {
      return webmention.content && webmention.content.text !== "";
    }

    return true;
  });
}

// save combined webmentions in cache file
function writeToCache(data: WebmentionsCache) {
  const fileContent = JSON.stringify(data, null, 2);

  // create cache folder if it doesn't already exist
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR);
  }

  //  Write data to cache json file
  fs.writeFile(filePath, fileContent, (err) => {
    if (err) throw err;
    console.log(`Webmentions saved to ${filePath}`);
  });
}

function getFromCache(): WebmentionsCache {
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  }
  // no cache found
  return {
    lastFetched: null,
    children: [],
  };
}

async function getAndCacheWebmentions() {
  const cache = getFromCache();
  const mentions = await fetchWebmentions(cache.lastFetched);

  if (mentions) {
    mentions.children = filterWebmentions(mentions.children);
    const webmentions: WebmentionsCache = {
      lastFetched: new Date().toISOString(),
      // Make sure first art is the cache
      children: mergeWebmentions(cache, mentions),
    };

    writeToCache(webmentions);
    return webmentions;
  }

  return cache;
}

let webMentions: WebmentionsCache;

export async function getWebmentionsForUrl(url: string) {
  if (!webMentions) webMentions = await getAndCacheWebmentions();

  return webMentions.children.filter((entry) => entry["wm-target"] === url);
}