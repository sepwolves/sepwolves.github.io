---
title: <% tp.date.now("YYYYMMDDHHmmss") %>
date: <% tp.date.now("YYYY-MM-DD HH:mm:ss") %>
tags: []
categories: []
---
<%*
// 这段脚本会在应用模板的一瞬间，自动把“未命名”的文件名改为“当前时间”
await tp.file.rename(tp.date.now("YYYYMMDDHHmmss"))
%>

# <% tp.date.now("YYYYMMDDHHmmss") %>

<% tp.file.cursor() %>
