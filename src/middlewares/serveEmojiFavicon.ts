import { Request, Response, NextFunction, RequestHandler } from "express";

const serveEmojiFavicon = (emoji: string): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === "/favicon.ico") {
      res.header("Content-Type", "image/svg+xml");
      res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" x="-0.1em" font-size="90">${emoji}</text></svg>`);
    }
    next();
  };
};

export default serveEmojiFavicon;
