# Agent Studio Local Bridge

跨平台桌面 companion，支持 Windows、macOS 和 Linux。启动后在 Portal 的“我的电脑”中生成配对码，输入后选择要授权的目录即可。

## 开发

```bash
npm install
npm start
```

## 打包

```bash
npm run dist
```

`electron-builder` 会生成 macOS DMG/ZIP、Windows NSIS/ZIP、Linux AppImage/DEB。
