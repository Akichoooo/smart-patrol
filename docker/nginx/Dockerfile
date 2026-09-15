# 前端镜像：直接使用本机 npm run build 产物（src/main/resources/static）
# 产物由 web-react/vite.config.ts 的 outDir '../src/main/resources/static' 生成
# 本机构建命令：cd web-react && NODE_OPTIONS=--max-old-space-size=2048 npm run build
FROM nginx:alpine

ARG TZ=Asia/Shanghai

COPY ./src/main/resources/static /opt/dist

CMD ["nginx","-g","daemon off;"]
