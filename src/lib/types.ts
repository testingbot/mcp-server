export type TestingBotConfig = {
  "testingbot-key": string;
  "testingbot-secret": string;
};

export interface TestingBotOptions {
  api_key?: string;
  api_secret?: string;
  debug?: boolean;
}

export interface Browser {
  browserName: string;
  version?: string;
  platform?: string;
  os?: string;
}

export interface Device {
  id: string;
  name: string;
  platform: string;
  version: string;
  available: boolean;
}

export interface Test {
  session_id: string;
  status: string;
  browser: string;
  version: string;
  platform: string;
  duration: number;
  created_at: string;
  [key: string]: any;
}

export interface Build {
  id: number;
  name: string;
  tests: number;
  created_at: string;
  [key: string]: any;
}

// Shape of the TestingBot `GET /v1/user` response. Note the API does NOT return
// an `email` field, nor `minutes_used`/`minutes_limit`; available time is exposed
// as `seconds`. All fields are optional so a partial response degrades cleanly.
export interface UserInfo {
  first_name?: string;
  last_name?: string;
  email?: string;
  plan?: string;
  company?: string;
  country?: string;
  seconds?: number;
  max_concurrent?: number;
  max_concurrent_mobile?: number;
  [key: string]: any;
}

export interface Screenshot {
  id: string;
  url: string;
  screenshots: Array<{
    browser: string;
    version: string;
    os: string;
    image_url: string;
    thumb_url: string;
  }>;
  [key: string]: any;
}

// Shape of an entry returned by GET /v1/storage
export interface StorageFile {
  id: number;
  app_url: string;
  url?: string;
  filename: string;
  type?: string;
  version?: string;
  min_device_version?: string | null;
  sim_only?: boolean | null;
  state?: string;
  thumb?: string | null;
  created_at: string;
}
