export const sections = {
  profile: { label: '个人信息', icon: 'user', note: '先让阅读者认识你，再用经历说明你的能力。' },
  education: { label: '教育背景', icon: 'education', note: '按最近的教育经历优先排列，学历与学位分别填写。' },
  experience: { label: '实习与工作', icon: 'briefcase', note: '说清楚你的岗位、负责的工作，以及取得的实际成果。' },
  awards: { label: '荣誉奖项', icon: 'award', note: '保留奖项的准确名称、等级与时间，让成果有据可查。' },
  projects: { label: '项目经历', icon: 'code', note: '介绍项目目标，突出你承担的部分和可验证的成果。' },
  skills: { label: '专业技能', icon: 'layers', note: '按类别组织能力，填写你能够在实际工作中运用的技能。' },
  settings: { label: '展示设置', icon: 'settings', note: '决定页面阅读顺序，以及哪些信息适合公开。' }
};

export const defaultOrder = ['education', 'experience', 'awards', 'projects', 'skills'];
export const fields = {
  profile: [
    ['name','姓名','text','如：周予安'], ['headline','求职方向 / 个人标题','text','如：Java 后端开发 · 2026 届'],
    ['email','邮箱','email','hello@example.com'], ['phone','电话','tel','填写可联系的电话号码'],
    ['location','所在城市','text','如：杭州'], ['website','个人网站 / 作品集','url','https://…'],
    ['summary','个人简介','textarea','用两三句话介绍你的方向、优势和目标。',true]
  ],
  education: [
    ['school','学校','text','学校全称'], ['major','专业','text','如：计算机科学与技术'],
    ['level','学历','text','如：本科 / 硕士研究生'], ['degree','学位','text','如：工学学士；原文未说明可留空'],
    ['startDate','入学时间','text','如：2022.09'], ['endDate','毕业时间','text','如：2026.06'],
    ['status','就读状态','text','如：在读 / 已毕业'], ['gpa','GPA / 成绩','text','如：3.8 / 4.0'],
    ['ranking','排名','text','如：专业前 10%'], ['courses','相关课程','textarea','按实际情况填写，可换行。',true]
  ],
  experience: [
    ['company','公司 / 组织','text','公司全称'], ['position','岗位','text','如：后端开发实习生'],
    ['department','部门','text','如：产品研发部'], ['type','经历类型','select',''],
    ['startDate','开始时间','text','如：2025.07'], ['endDate','结束时间','text','如：2025.09 / 至今'],
    ['location','工作地点','text','如：杭州'], ['technologies','相关技术 / 方法','text','如：Java、Spring Boot、MySQL'],
    ['responsibilities','工作内容与个人职责','textarea','你具体负责什么？每行描述一项工作。',true],
    ['achievements','成果与贡献','textarea','写明实际成果，数字与结论应有依据。',true]
  ],
  awards: [
    ['name','奖项 / 竞赛名称','text','填写奖项全称'], ['date','获奖时间','text','如：2025.06'],
    ['level','赛事 / 奖项级别','text','如：国家级 / 省级 / 校级'], ['prize','获奖等级','text','如：一等奖'],
    ['issuer','颁发单位','text','原文未说明可留空'], ['contribution','个人贡献 / 补充说明','textarea','如：团队获奖，负责后端服务开发。',true]
  ],
  projects: [
    ['name','项目名称','text','项目名称'], ['role','个人角色','text','如：后端开发'],
    ['startDate','开始时间','text','如：2025.03'], ['endDate','结束时间','text','如：2025.06'],
    ['url','项目 / 代码链接','url','https://…',true], ['summary','项目简介','textarea','这个项目服务谁，解决什么问题？',true],
    ['responsibilities','个人职责','textarea','具体说明你负责的部分，每行一项。',true],
    ['achievements','项目成果','textarea','填写可验证的成果，避免将团队贡献全部归于个人。',true],
    ['technologies','使用的技术 / 方法','text','如：Spring Boot、Redis、MySQL',true]
  ],
  skills: [['category','技能类别','text','如：编程语言 / 数据库'], ['items','技能内容','textarea','如：Java、SQL；也可以描述熟练程度。',true]]
};

export const uid = () => crypto.randomUUID ? crypto.randomUUID() : `i${Date.now()}${Math.random().toString(36).slice(2)}`;
export function newRecord(section) { return Object.fromEntries([['id', uid()], ...fields[section].map(([key])=>[key,key==='type'?'internship':''])]); }
export function emptyContent() {
  return { profile:Object.fromEntries(fields.profile.map(([k])=>[k,''])),education:[],experience:[],awards:[],projects:[],skills:[],settings:{order:[...defaultOrder],hidden:[],showEmail:true,showPhone:false,theme:'cobalt'} };
}
export function normalizeContent(value={}) {
  const c=emptyContent(); c.profile={...c.profile,...value.profile};
  for(const key of defaultOrder) c[key]=(Array.isArray(value[key])?value[key]:[]).map(row=>({...newRecord(key),...row,id:row.id||uid()}));
  c.settings={...c.settings,...value.settings};
  c.settings.order=[...new Set([...(Array.isArray(c.settings.order)?c.settings.order:[]),...defaultOrder])].filter(x=>defaultOrder.includes(x));
  c.settings.hidden=(Array.isArray(c.settings.hidden)?c.settings.hidden:[]).filter(x=>defaultOrder.includes(x));
  return c;
}
export const demoNotice = '院校、企业及赛事名称真实，人物与个人经历为模拟内容';
export function demoContent() {
  return normalizeContent({
    profile:{name:'周予安',headline:'Java 后端开发工程师 · 2026 届',email:'zhou.yuan@example.com',phone:'138****6207',location:'杭州',summary:'2026 届软件工程本科毕业生，关注后端接口、数据库设计与测试质量。'},
    education:[{id:'edu-demo',school:'杭州电子科技大学',major:'软件工程',level:'本科',degree:'工学学士',startDate:'2022.09',endDate:'2026.06',status:'已毕业',gpa:'',ranking:'18/156',courses:'数据结构、操作系统、计算机网络、数据库原理、软件工程'}],
    experience:[
      {id:'exp-demo',company:'恒生电子股份有限公司',position:'Java 开发实习生',department:'',type:'internship',startDate:'2025.07',endDate:'2025.09',location:'杭州',responsibilities:'参与业务管理后台开发，负责查询接口、参数校验及异常处理。\n协助排查慢查询，补充接口文档与回归测试用例。',achievements:'完成 5 个接口；在固定测试数据下，查询平均耗时由 620ms 降至 280ms。',technologies:'Java · Spring Boot · MyBatis · MySQL'},
      {id:'exp-demo-2',company:'杭州有赞科技有限公司',position:'Java 后端开发实习生',department:'',type:'internship',startDate:'2024.07',endDate:'2024.09',location:'杭州',responsibilities:'参与商家后台订单列表、条件筛选和分页查询功能开发。\n配合测试人员复现缺陷，修复空值处理和查询条件校验问题。',achievements:'完成 4 个查询接口，补充 24 条单元测试，整理接口联调说明。',technologies:'Java · Spring Boot · MySQL · Git · JUnit'}
    ],
    awards:[
      {id:'award-demo',name:'第十六届蓝桥杯全国软件和信息技术专业人才大赛',date:'2025.06',level:'国家级',prize:'二等奖',issuer:'',contribution:'Java 软件开发大学 B 组，全国总决赛，个人赛。'},
      {id:'award-demo-2',name:'第十六届蓝桥杯全国软件和信息技术专业人才大赛',date:'2025.04',level:'省级',prize:'一等奖',issuer:'',contribution:'Java 软件开发大学 B 组，浙江赛区省赛，个人赛。'},
      {id:'award-demo-3',name:'杭州电子科技大学优秀学生奖学金',date:'2025.04',level:'校级',prize:'二等奖',issuer:'',contribution:''}
    ],
    projects:[
      {id:'project-demo',name:'实验室预约管理系统',role:'后端开发',startDate:'2025.01',endDate:'2025.05',summary:'3 人课程项目，支持设备查询、时段预约、审批和取消预约。',responsibilities:'设计预约表和角色权限；用事务与唯一约束处理同一时段重复预约。',achievements:'完成 12 个接口及 30 条测试用例，验证预约冲突与越权访问场景。',technologies:'Java · Spring Boot · MyBatis · MySQL',url:''},
      {id:'project-demo-2',name:'校园二手交易平台',role:'后端负责人',startDate:'2024.03',endDate:'2024.06',summary:'3 人课程项目，实现商品发布、检索、下单及订单状态查询。',responsibilities:'负责商品与订单接口、登录校验；使用 Redis 缓存商品分类数据。',achievements:'完成 16 个接口，提供数据库脚本、接口文档与本地部署说明。',technologies:'Java · Spring Boot · MySQL · Redis',url:''}
    ],
    skills:[
      {id:'skill-demo',category:'编程语言',items:'Java、SQL；理解集合、异常处理及面向对象基础'},
      {id:'skill-demo-2',category:'后端框架',items:'Spring Boot、Spring MVC、MyBatis；能编写 REST 接口'},
      {id:'skill-demo-3',category:'数据存储',items:'MySQL、Redis；了解索引、事务及常见缓存使用方式'},
      {id:'skill-demo-4',category:'开发工具',items:'Git、Maven、Docker、JUnit；能完成本地部署和接口测试'}
    ]
  });
}
export const demoSource=`周予安
${demoNotice}。
求职意向：Java 后端开发工程师 · 2026 届
邮箱：zhou.yuan@example.com
电话：138****6207
现居地：杭州
个人简介：2026 届软件工程本科毕业生，关注后端接口、数据库设计与测试质量。

教育背景
2022.09 — 2026.06 | 杭州电子科技大学 | 软件工程 | 本科 | 工学学士 | 已毕业
专业排名：18/156
主修课程：数据结构、操作系统、计算机网络、数据库原理、软件工程

实习经历
2025.07 — 2025.09 | 恒生电子股份有限公司 | Java 开发实习生
工作地点：杭州
工作内容：参与业务管理后台开发，负责查询接口、参数校验及异常处理。
工作内容：协助排查慢查询，补充接口文档与回归测试用例。
技术栈：Java、Spring Boot、MyBatis、MySQL
成果：完成 5 个接口；在固定测试数据下，查询平均耗时由 620ms 降至 280ms。
2024.07 — 2024.09 | 杭州有赞科技有限公司 | Java 后端开发实习生
工作地点：杭州
工作内容：参与商家后台订单列表、条件筛选和分页查询功能开发。
工作内容：配合测试人员复现缺陷，修复空值处理和查询条件校验问题。
技术栈：Java、Spring Boot、MySQL、Git、JUnit
成果：完成 4 个查询接口，补充 24 条单元测试，整理接口联调说明。

荣誉奖项
2025.06 | 第十六届蓝桥杯全国软件和信息技术专业人才大赛 | 国家级 | 二等奖
个人贡献：Java 软件开发大学 B 组，全国总决赛，个人赛。
2025.04 | 第十六届蓝桥杯全国软件和信息技术专业人才大赛 | 省级 | 一等奖
个人贡献：Java 软件开发大学 B 组，浙江赛区省赛，个人赛。
2025.04 | 杭州电子科技大学优秀学生奖学金 | 校级 | 二等奖

项目经历
2025.01 — 2025.05 | 实验室预约管理系统 | 后端开发
项目背景：3 人课程项目，支持设备查询、时段预约、审批和取消预约。
个人职责：设计预约表和角色权限；用事务与唯一约束处理同一时段重复预约。
技术栈：Java、Spring Boot、MyBatis、MySQL
项目成果：完成 12 个接口及 30 条测试用例，验证预约冲突与越权访问场景。
2024.03 — 2024.06 | 校园二手交易平台 | 后端负责人
项目背景：3 人课程项目，实现商品发布、检索、下单及订单状态查询。
个人职责：负责商品与订单接口、登录校验；使用 Redis 缓存商品分类数据。
技术栈：Java、Spring Boot、MySQL、Redis
项目成果：完成 16 个接口，提供数据库脚本、接口文档与本地部署说明。

专业技能
编程语言：Java、SQL；理解集合、异常处理及面向对象基础
后端框架：Spring Boot、Spring MVC、MyBatis；能编写 REST 接口
数据存储：MySQL、Redis；了解索引、事务及常见缓存使用方式
开发工具：Git、Maven、Docker、JUnit；能完成本地部署和接口测试`;
