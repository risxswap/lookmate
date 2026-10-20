# Vue 实现参考

保持组件公开的 props、事件与插槽契约；父组件拥有输入数据，子组件通过事件表达变更意图，避免直接修改 props 或隐式改写共享对象。列表 key 使用稳定业务标识，有状态列表不以索引替代身份。

派生值优先计算属性；watch 用于副作用，核对依赖、重复触发及清理。真实复用的逻辑抽为 composable，跨页面共享且有明确生命周期的数据才放入 store，页面临时表单留在页面。SSR 项目检查请求间状态隔离和客户端 API 使用时机；普通 SPA 不引入 SSR。

Vue 3 / TypeScript 中明确 props、emits、接口响应及可空状态类型，避免用 any 或强制断言掩盖真实分支。参考 [Vue TypeScript 指南](https://vuejs.org/guide/typescript/composition-api.html) 时核对小版本支持，不把新编译器行为套到旧版本。已有 Vue 2 或 JavaScript 项目沿用其响应式机制和测试设施，不为局部任务迁移。

订阅、监听器、定时器和请求在失效或卸载时清理。跨筛选和路由的数据竞争按 [API 与认证](api-and-auth.md) 处理。

Vue 的 [watch 清理机制](https://vuejs.org/guide/essentials/watchers.html) 随版本不同：onWatcherCleanup 是 Vue 3.5+ API，且须在同步阶段注册；选择当前版本支持的 onCleanup 回调或生命周期清理方式。取消不支持的客户端可使用请求标识保护，不强制更换客户端。
