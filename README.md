Serves ES6 NodeJS modules.

**NOTE: I don't (currently) want to be on the hook for maintaining this; if you plan on using this project, copy it to your own project space, rebrand it if desired, and make changes there (or find somebody who will maintain it for you).**

##### Docs

Below is some crappy example documentation; I might want to update this soon.

Something like:

```javascript
/* 
Expects the following working directory structure:

your-project
  |-- client_dist
  |   |-- index.html
  |   |-- favicon.ico
  |   |-- index.mjs

*/

import { createServer } from "node-web";

createServer({
  onCreate({ expressApp, httpServer, addFile, addHandledFile, addPackage, addModuleFile, serve }) {
    addFile("/", "./client_dist/index.html");
    addFile("/favicon.ico", "./client_dist/favicon.ico");
    addModuleFile("/index.mjs", "./client_dist/index.mjs", (req, content, res) => {
      // do something to content
      res.send(content);
    });
    serve();
  }
});
```

Expected output:
```
/ --> C:\Users\...\your-project\client_dist\index.html
/favicon.ico --> C:\Users\...\your-project\client_dist\favicon.ico
/index.mjs --> C:\Users\...\your-project\client_dist\index.mjs (+ post-processing)
Serving webpage at *.3000
```


Use global paths (with something like __dirname for your file) if you expect to change the working directory around.
If __dirname is not available, use:

```javascript
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
```

Then:

```javascript
...
createServer({
  onCreate({ addFile, addHandledFile, addPackage, serve }) {
    addFile("/", path.join(__dirname, "/client_dist/index.html"));
...
```

The coolest (and least documented feature here) is the addPackage function - something like:

```javascript
...
createServer({
  onCreate({ addFile, addHandledFile, addPackage, serve }) {
    addPackage("rfunc", "./node_modules/rfunc", () => {
      // Do stuff after package has been imported
    });
...
```

It should theoretically take care of the unpleasant (but historically canon) tendency of web browsers to import javascript files from a global perspective.

Now, it should kinda emulate ES6 relative and sub-package imports.

This was the most confusing piece to code, so it might need a bit of rework.
