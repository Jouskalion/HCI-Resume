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
    ['name','姓名','text','如：林知远'], ['headline','求职方向 / 个人标题','text','如：Java 后端开发 · 2027 届'],
    ['email','邮箱','email','hello@example.com'], ['phone','电话','tel','填写可联系的电话号码'],
    ['location','所在城市','text','如：杭州'], ['website','个人网站 / 作品集','url','https://…'],
    ['summary','个人简介','textarea','用两三句话介绍你的方向、优势和目标。',true]
  ],
  education: [
    ['school','学校','text','学校全称'], ['major','专业','text','如：计算机科学与技术'],
    ['level','学历','text','如：本科 / 硕士研究生'], ['degree','学位','text','如：工学学士；原文未说明可留空'],
    ['startDate','入学时间','text','如：2023.09'], ['endDate','毕业时间','text','如：2027.06'],
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
export function demoContent() {
  return normalizeContent({
    profile:{name:'林知远',headline:'Java 后端开发 · 2027 届',email:'linzhiyuan@example.com',location:'杭州',summary:'关注可靠、高效的后端服务，喜欢将复杂问题拆解为清晰的解决方案。希望在真实业务中持续打磨工程能力。'},
    education:[{id:'edu-demo',school:'示例理工大学',major:'计算机科学与技术',level:'本科',degree:'',startDate:'2023.09',endDate:'2027.06',status:'在读',gpa:'3.8 / 4.0',ranking:'专业前 10%',courses:'数据结构、操作系统、计算机网络、数据库原理'}],
    experience:[{id:'exp-demo',company:'示例科技有限公司',position:'Java 后端开发实习生',department:'研发部',type:'internship',startDate:'2026.07',endDate:'2026.09',location:'杭州',responsibilities:'参与订单服务开发，负责订单查询接口与参数校验。\n协助梳理慢查询日志，为高频查询建立合适的索引。',achievements:'测试环境中，某订单查询接口平均响应时间由 800ms 降至 300ms。',technologies:'Java · Spring Boot · MySQL'}],
    awards:[{id:'award-demo',name:'大学生软件设计竞赛（示例）',date:'2026.05',level:'省级',prize:'二等奖',issuer:'',contribution:'团队成员，负责服务端接口设计与实现。'},{id:'award-demo-2',name:'校级学业奖学金（示例）',date:'2025.11',level:'校级',prize:'一等奖',issuer:'',contribution:''}],
    projects:[{id:'project-demo',name:'校园闲置物品交流平台',role:'后端开发',startDate:'2025.10',endDate:'2026.03',summary:'面向校园用户的闲置物品发布与交流工具，为物品信息检索和交易意向沟通提供支持。',responsibilities:'设计用户、商品与收藏模块的数据模型和接口。\n实现基于 Redis 的热点商品信息缓存，并补充接口测试。',achievements:'完成从需求拆解、接口实现到部署验证的完整开发过程。',technologies:'Spring Boot · MySQL · Redis',url:''}],
    skills:[{id:'skill-demo',category:'编程与框架',items:'Java、Spring Boot、MyBatis'},{id:'skill-demo-2',category:'数据与工具',items:'MySQL、Redis、Git、Linux'}]
  });
}
export const demoSource='【演示简历 · 人物、学校、经历与成果均为虚构】\n\n林知远\nJava 后端开发 · 2027 届\n杭州 | linzhiyuan@example.com\n\n教育背景\n示例理工大学 | 计算机科学与技术 | 本科在读\n2023.09—2027.06 | GPA 3.8 / 4.0 | 专业前 10%\n\n实习经历\n示例科技有限公司 | Java 后端开发实习生 | 研发部\n2026.07—2026.09 | 杭州\n参与订单服务开发，负责订单查询接口与参数校验。\n协助梳理慢查询日志，为高频查询建立合适的索引。\n测试环境中，某订单查询接口平均响应时间由 800ms 降至 300ms。\n技术：Java、Spring Boot、MySQL\n\n荣誉奖项\n大学生软件设计竞赛（示例） | 省级二等奖 | 2026.05\n团队成员，负责服务端接口设计与实现。\n校级学业奖学金（示例） | 一等奖 | 2025.11\n\n项目经历\n校园闲置物品交流平台 | 后端开发 | 2025.10—2026.03\n面向校园用户的闲置物品发布与交流工具。\n设计用户、商品与收藏模块的数据模型和接口。\n实现基于 Redis 的热点商品信息缓存，并补充接口测试。\n完成从需求拆解、接口实现到部署验证的完整开发过程。\n技术：Spring Boot、MySQL、Redis\n\n专业技能\nJava、Spring Boot、MyBatis；MySQL、Redis、Git、Linux';
