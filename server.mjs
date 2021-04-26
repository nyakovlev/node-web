import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import colors from "colors";


export function fixModuleImportsForWeb(content) {
  let oldLines = content.split(/\r?\n/);
  let newLines = [];
  for (let line of oldLines) {
    if (line.startsWith("import ")) {
      let fields = line.split(" ");
      let prefix = fields.slice(0, -1).join(" ");
      let oldPath = fields.slice(-1)[0];
      if (oldPath.endsWith(";")) {
        oldPath = oldPath.slice(0, -1);
      }
      oldPath = oldPath.slice(1, -1);
      if (!oldPath.startsWith(".") && !oldPath.startsWith("/")) {
        let newLine = `${prefix} "/${oldPath}";`;
        console.log(`${colors.red(line)} --> ${colors.green(newLine)}`);
        newLines.push(newLine);
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }
  content = newLines.join("\n");
  return content;
}


export default function createServer({port=3000, fileRoutes={}, onCreate}) {
  let app = express();
  let server = http.createServer(app);

  let addFile = (route, filePath) => {
    let absFilePath = path.resolve(filePath);
    console.log(`+ web ${colors.green(route)} ${colors.grey("-->")} ${colors.cyan(absFilePath)}`);
    app.get(route, (req, res) => {
      res.sendFile(absFilePath);
    });
  }

  for (let route in fileRoutes) {
    addFile(route, fileRoutes[route]);
  }

  let addHandledFile = (route, filePath, handler) => {
    let absFilePath = path.resolve(filePath);
    console.log(`+ web ${colors.green(route)} ${colors.grey("-->")} ${colors.cyan(absFilePath)} ${colors.yellow("(+ post-processing)")}`);
    app.get(route, (req, res) => {
      fs.readFile(absFilePath, (err, data) => {
        if (err) {
          throw `Failed to read file at ${filePath} (resolved to ${absFilePath})`, err
        }
        let content = data.toString();
        handler(req, content, res);
      });
    });
  }

  let processImport = (importLine, routeDir) => {
    let fields = importLine.split(" ");
    let prefix = fields.slice(0, -1).join(" ");
    
    let oldPath = fields.slice(-1)[0];
    if (oldPath.endsWith(";")) {
      oldPath = oldPath.slice(0, -1);
    }
    oldPath = oldPath.slice(1, -1);

    let subLocalPath = oldPath;
    if (!subLocalPath.startsWith(".")) {
      if (!subLocalPath.startsWith("/")) {
        subLocalPath = "/" + subLocalPath;
      }
      subLocalPath = `./node_modules${subLocalPath}`;
    }
    let newPath = path.join(routeDir, subLocalPath).replaceAll("\\", "/");

    let subRoute = path.join(routeDir, oldPath).replaceAll("\\", "/");
    let newLine = `${prefix} "${newPath}";`;

    console.log(`${colors.red(importLine)} --> ${colors.green(newLine)}`);

    return {
      subRoute,
      subLocalPath,
      newLine
    };
  }

  let moduleCache = {};

  let addModule = (route, rootPath, localPath, callback, routeOverride) => {
    let filePath = path.resolve(rootPath, localPath);
    if (!filePath.startsWith(rootPath)) {
      console.error(`INSECURE!! Package ${route} requested local path ${localPath}, which resolved outside the package scope:\nScope:     ${rootPath}\nRequested: ${filePath}`);
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {throw `Failed to read module at ${filePath}`}
      let oldLines = data.toString().split(/\r?\n/);
      let newLines = [];
      let subModules = [];
      let routeDir = route.split("/").slice(0, -1).join("/");
      for (let oldLine of oldLines) {
        if (oldLine.startsWith("import ")) {
          let { subRoute, subLocalPath, newLine } = processImport(oldLine, routeDir);
          newLines.push(newLine);
          subModules.push({ subRoute, subLocalPath });
        } else {
          newLines.push(oldLine);
        }
      }

      let servedRoute = routeOverride || route;
      moduleCache[servedRoute] = newLines.join("\n");
      console.log(`+ web ${colors.green(servedRoute)} ${colors.grey("-->")} ${colors.cyan(filePath)}`);
      app.get(servedRoute, (req, res) => {
        res.setHeader("content-type", "text/javascript");
        res.send(moduleCache[servedRoute]);
      });

      let addSubModules = (pending, loopCallback) => {
        if (!pending.length) {
          loopCallback();
          return;
        }
        let { subRoute, subLocalPath } = pending[0];
        console.log(colors.grey(`Linking ${localPath} to ${subLocalPath}...`));
        addModule(subRoute, rootPath, subLocalPath, () => {
          addSubModules(pending.slice(1), loopCallback);
        });
      };

      addSubModules(subModules, callback);
    });
  };

  // TODO: Allow addModule to call addPackage, and give addPackage a base path for recursive package directories.
  let addPackage = (name, folderPath, callback) => {
    console.log(colors.bold(`${colors.blue("~~~")} + web package ${colors.yellow(name)} ${colors.blue("~~~")}`));
    let rootPath = path.resolve(folderPath);
    let configPath = path.join(rootPath, "package.json");
    fs.readFile(configPath, (err, data) => {
      if (err) {
        throw `Failed to open package.json in ${folderPath} (resolved to ${configPath})`;
      }
      let config = JSON.parse(data.toString());
      let imports = [];
      if ("main" in config) {
        imports.push({
          name: "/" + name,
          localPath: config.main
        });
      }
      if ("exports" in config) {
        for (let exportName in config.exports) {
          let targetPath = config.exports[exportName];
          // TODO: Create a callback system to add each path
          if ("*" in exportName || "*" in targetPath) {
            console.warn(`Support not added yet for wildcards in exports! This export will fail: ${exportName} -> ${targetPath}`);
            continue;
          }
          let absExportName = path.join(name, exportName).replaceAll("\\", "/");
          imports.push({
            name: "/" + absExportName,
            localPath: targetPath
          });
        }
      }
      let addModules = (modules, onAdded) => {
        if (modules.length) {
          let { name, localPath } = modules[0];
          addModule(
            path.join(name, localPath).replaceAll("\\", "/"),
            rootPath,
            localPath,
            () => {
              addModules(modules.slice(1), onAdded);
            },
            name
          );
          return;
        }
        onAdded();
      };
      addModules(imports, () => {
        console.log(colors.cyan("~~~"));
        if (callback) {
          callback();
        }
      });
    });
  };

  let addModuleFile = (route, filePath, handler, callback) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {throw err;}
      let content = data.toString();
      content = fixModuleImportsForWeb(content);
      console.log(`+ web ${colors.green(route)} ${colors.grey("-->")} ${colors.cyan(filePath)} ${colors.yellow("(+ post-processing)")}`);
      app.get(route, (req, res) => {
        res.setHeader("content-type", "text/javascript");
        if (handler) {
          handler(req, content, res);
          return;
        }
        res.send(content);
      });
      if (callback) {
        callback();
      }
    });
  };

  let serve = () => {
    server.listen(port, () => {
      console.log(`Running web server on *:${port}...`);
    });
  }

  if (onCreate) {
    onCreate({
      expressApp: app,
      httpServer: server,
      serve,
      addFile,
      addHandledFile,
      addPackage,
      addModule,
      addModuleFile
    });
  }
}
