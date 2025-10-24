export const SessionType = {
  WebDriver: "webdriver",
  Selenium: "selenium",
} as const;

export const LogType = {
  SeleniumLog: "selenium-log",
  NetworkLog: "network-log",
  VitalsLog: "vitals-log",
  VideoLog: "video-log",
} as const;

export const TestStatus = {
  Passed: "passed",
  Failed: "failed",
  Error: "error",
  Running: "running",
  Queued: "queued",
} as const;

export const Platform = {
  Windows: "WINDOWS",
  Mac: "MAC",
  Linux: "LINUX",
  Android: "ANDROID",
  iOS: "IOS",
} as const;

export const BrowserType = {
  Chrome: "chrome",
  Firefox: "firefox",
  Safari: "safari",
  Edge: "microsoftedge",
  IE: "internet explorer",
} as const;
