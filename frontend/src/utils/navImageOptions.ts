// 首页导航卡片的可选封面图。业务域卡片与分类卡片各有一套预置图，后台按类别下拉选图。

export interface NavImageOption {
  value: string;
  label: string;
}

// 业务域卡片封面（public/domain-covers/*.png）
export const DOMAIN_IMAGE_OPTIONS: NavImageOption[] = [
  { value: '/domain-covers/marketing.png', label: '营销' },
  { value: '/domain-covers/finance.png', label: '财务' },
  { value: '/domain-covers/equipment.png', label: '设备' },
  { value: '/domain-covers/safety.png', label: '安全' },
  { value: '/domain-covers/environment.png', label: '环保' },
  { value: '/domain-covers/hr.png', label: '人力' },
  { value: '/domain-covers/it.png', label: '信息' },
  { value: '/domain-covers/energy.png', label: '能源' },
  { value: '/domain-covers/quality.png', label: '质量' },
  { value: '/domain-covers/management.png', label: '管理' },
  { value: '/domain-covers/production.png', label: '生产' },
  { value: '/domain-covers/rd.png', label: '研发' },
  { value: '/domain-covers/procurement.png', label: '采购' },
  { value: '/domain-covers/investment.png', label: '投资' },
];

// 分类卡片封面（public/category-covers/*.png）
export const CATEGORY_IMAGE_OPTIONS: NavImageOption[] = [
  { value: '/category-covers/policy.png', label: '政策制度' },
  { value: '/category-covers/standard.png', label: '标准规范' },
  { value: '/category-covers/process.png', label: '流程与程序' },
  { value: '/category-covers/technical.png', label: '技术规程与诀窍' },
  { value: '/category-covers/case.png', label: '案例' },
  { value: '/category-covers/report.png', label: '报告' },
  { value: '/category-covers/patent.png', label: '专利与知识产权' },
  { value: '/category-covers/training.png', label: '培训资源' },
  { value: '/category-covers/industry.png', label: '行业情报' },
];
