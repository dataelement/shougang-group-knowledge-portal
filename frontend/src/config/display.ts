export const DISPLAY_CONFIG = {
  home: {
    sectionPageSize: 6,
    hotTagsCount: 8,
    qaHotCount: 4,
    domainCount: 10,
    spacesCount: 6,
    appsCount: 6,
  },
  list: {
    pageSize: 10,
    visibleTagCount: 2,
  },
  search: {
    pageSize: 10,
    visibleTagCount: 2,
  },
  detail: {
    relatedFilesCount: 3,
    visibleTagCount: 2,
  },
} as const;

export const DISPLAY_CONFIG_ITEMS = [
  { group: '首页', key: 'home.sectionPageSize', label: '知识推荐/典型案例条数', value: DISPLAY_CONFIG.home.sectionPageSize },
  { group: '首页', key: 'home.hotTagsCount', label: '热门标签条数', value: DISPLAY_CONFIG.home.hotTagsCount },
  { group: '首页', key: 'home.qaHotCount', label: '技术问答热门问题条数', value: DISPLAY_CONFIG.home.qaHotCount },
  { group: '首页', key: 'home.domainCount', label: '业务域导航条数', value: DISPLAY_CONFIG.home.domainCount },
  { group: '首页', key: 'home.spacesCount', label: '知识广场条数', value: DISPLAY_CONFIG.home.spacesCount },
  { group: '首页', key: 'home.appsCount', label: '应用市场条数', value: DISPLAY_CONFIG.home.appsCount },
  { group: '列表页', key: 'list.pageSize', label: '列表页每页文档数', value: DISPLAY_CONFIG.list.pageSize },
  { group: '列表页', key: 'list.visibleTagCount', label: '列表页单条标签展示数', value: DISPLAY_CONFIG.list.visibleTagCount },
  { group: '搜索页', key: 'search.pageSize', label: '搜索页每页文档数', value: DISPLAY_CONFIG.search.pageSize },
  { group: '搜索页', key: 'search.visibleTagCount', label: '搜索页单条标签展示数', value: DISPLAY_CONFIG.search.visibleTagCount },
  { group: '详情页', key: 'detail.relatedFilesCount', label: '相关推荐条数', value: DISPLAY_CONFIG.detail.relatedFilesCount },
  { group: '详情页', key: 'detail.visibleTagCount', label: '相关推荐标签展示数', value: DISPLAY_CONFIG.detail.visibleTagCount },
] as const;
