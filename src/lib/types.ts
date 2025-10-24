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

export interface UserInfo {
  first_name: string;
  last_name: string;
  email: string;
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

export interface StorageFile {
  app_url: string;
  name: string;
  size: number;
  uploaded_at: string;
}
