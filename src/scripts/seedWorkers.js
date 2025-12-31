import db from "../config/db.js";

const workers = [
  {
    legacy_id: 9,
    worker_code: "Cs1",
    worker_name: "保安服务",
    worker_english_name: "Security Services",
    passport_no: "",
    employment_start: "6/1/2018",
    nationality: "",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 13,
    worker_code: "ac",
    worker_name: "账目处理",
    worker_english_name: "Book Keeping-Taxser",
    passport_no: "",
    employment_start: "6/1/2018",
    nationality: "",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 22,
    worker_code: "Cs4",
    worker_name: "卫生费",
    worker_english_name: "Cleaners",
    passport_no: "",
    employment_start: "6/1/2018",
    nationality: "",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 28,
    worker_code: "Cs2",
    worker_name: "白班",
    worker_english_name: "Day Shift",
    passport_no: "",
    employment_start: "6/1/2018",
    nationality: "",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 29,
    worker_code: "Cs3",
    worker_name: "晚班",
    worker_english_name: "Night Shift",
    passport_no: "",
    employment_start: "6/1/2018",
    nationality: "",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 30,
    worker_code: "Cs6",
    worker_name: "经理工资2",
    worker_english_name: "Zou He Qing",
    passport_no: "E60650462",
    employment_start: "6/1/2018",
    nationality: "",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 40,
    worker_code: "Cs5",
    worker_name: "前台",
    worker_english_name: "Counter Workers",
    passport_no: "",
    employment_start: "6/1/2018",
    nationality: "",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 97,
    worker_code: "Csh",
    worker_name: "白晚班/卫/洗",
    worker_english_name: "Petty Cash",
    passport_no: "",
    employment_start: "",
    nationality: "",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 98,
    worker_code: "998",
    worker_name: "账目处理",
    worker_english_name: "Taxser",
    passport_no: "",
    employment_start: "",
    nationality: "",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 99,
    worker_code: "999",
    worker_name: "经理工资1",
    worker_english_name: "Zou He Qing",
    passport_no: "E60650462",
    employment_start: "",
    nationality: "",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 102,
    worker_code: "6",
    worker_name: "伍申平",
    worker_english_name: "Li YuXiang",
    passport_no: "ED2613081",
    employment_start: "6/1/2018",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 103,
    worker_code: "-8",
    worker_name: "Enita",
    worker_english_name: "Enita Juin Joni Atuk",
    passport_no: "A7727187",
    employment_start: "6/1/2018",
    nationality: "China3",
    terminated: "",
    field1: "resigned"
  },
  {
    legacy_id: 104,
    worker_code: "-9",
    worker_name: "于丽文",
    worker_english_name: "Yu LiWen",
    passport_no: "EC9501075",
    employment_start: "6/1/2018",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 106,
    worker_code: "-66",
    worker_name: "邹和清",
    worker_english_name: "Zou He Qing",
    passport_no: "E60650462",
    employment_start: "6/1/2018",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 108,
    worker_code: "R19",
    worker_name: "杨顺美",
    worker_english_name: "Yang Shu Mei",
    passport_no: "ED7670093",
    employment_start: "8/3/2018",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 109,
    worker_code: "R5",
    worker_name: "项永菊",
    worker_english_name: "Xiang Yong Ju",
    passport_no: "ED1901151",
    employment_start: "8/3/2018",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 110,
    worker_code: "-7",
    worker_name: "顾冬梅",
    worker_english_name: "Gu Dong Mei",
    passport_no: "E30678199",
    employment_start: "8/11/2018",
    nationality: "China2",
    terminated: "",
    field1: "M"
  },
  {
    legacy_id: 111,
    worker_code: "1",
    worker_name: "Warsiki",
    worker_english_name: "Warsiki",
    passport_no: "E3087921",
    employment_start: "7/1/2023",
    nationality: "China3",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 112,
    worker_code: "08",
    worker_name: "刘月梅",
    worker_english_name: "Liu, YueMei",
    passport_no: "EH3088244",
    employment_start: "",
    nationality: "China3",
    terminated: "",
    field1: "M"
  },
  {
    legacy_id: 113,
    worker_code: "-3",
    worker_name: "蹇艳龙",
    worker_english_name: "Jian YanLong",
    passport_no: "E98091887",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 115,
    worker_code: "5",
    worker_name: "李群芳",
    worker_english_name: "Li, QunFang",
    passport_no: "EK1026406",
    employment_start: "7/1/2023",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 117,
    worker_code: "96",
    worker_name: "李淼",
    worker_english_name: "Li Miao",
    passport_no: "E85645534",
    employment_start: "2/14/2019",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 118,
    worker_code: "R16",
    worker_name: "郭亚萍",
    worker_english_name: "Guo Ya Ping",
    passport_no: "EE3454690",
    employment_start: "2/15/2019",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 119,
    worker_code: "R17",
    worker_name: "王凤娇",
    worker_english_name: "Wang FengJiao",
    passport_no: "E98084842",
    employment_start: "8/3/2018",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 121,
    worker_code: "R9",
    worker_name: "彭俊",
    worker_english_name: "Peng Jun",
    passport_no: "ED4973329",
    employment_start: "6/1/2018",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 122,
    worker_code: "19",
    worker_name: "邹菊华",
    worker_english_name: "Zou JuHua",
    passport_no: "ED6292200",
    employment_start: "8/3/2018",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 124,
    worker_code: "69",
    worker_name: "刘春梅",
    worker_english_name: "Liu,ChunMei",
    passport_no: "EG8956062",
    employment_start: "8/1/2019",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 126,
    worker_code: "R3",
    worker_name: "冯艳华",
    worker_english_name: "Feng, YanHua",
    passport_no: "E24183271",
    employment_start: "5/15/2022",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 127,
    worker_code: "-5",
    worker_name: "李帅",
    worker_english_name: "Li, Shuai",
    passport_no: "E81592407",
    employment_start: "5/15/2022",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 128,
    worker_code: "-23",
    worker_name: "艾志亭",
    worker_english_name: "Ai ZhiTing",
    passport_no: "E90053305",
    employment_start: "8/17/2022",
    nationality: "China2",
    terminated: "",
    field1: "M"
  },
  {
    legacy_id: 129,
    worker_code: "16",
    worker_name: "杜春艳",
    worker_english_name: "Du Chun Yan",
    passport_no: "EF1304999",
    employment_start: "1/6/2023",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 130,
    worker_code: "o7",
    worker_name: "艾丽莎",
    worker_english_name: "Ai Li Sha",
    passport_no: "E44172091",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 132,
    worker_code: "R-9",
    worker_name: "印尼员工",
    worker_english_name: "Wu, ShenPing",
    passport_no: "EC7678575",
    employment_start: "7/1/2023",
    nationality: "China3",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 133,
    worker_code: "55",
    worker_name: "临时55号",
    worker_english_name: "Part time 55",
    passport_no: "",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 135,
    worker_code: "10",
    worker_name: "王静",
    worker_english_name: "WANG, JING",
    passport_no: "EG5483683",
    employment_start: "10/1/2023",
    nationality: "China3",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 136,
    worker_code: "-2",
    worker_name: "蹇艳凤",
    worker_english_name: "JIAN, YANFENG",
    passport_no: "E48099679",
    employment_start: "10/1/2023",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 137,
    worker_code: "50",
    worker_name: "金花",
    worker_english_name: "JIN HUA",
    passport_no: "EH2633434",
    employment_start: "8/3/2018",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 138,
    worker_code: "-6",
    worker_name: "李玉香",
    worker_english_name: "Li YuXiang",
    passport_no: "ED2613081",
    employment_start: "6/1/2018",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 139,
    worker_code: "n9",
    worker_name: "印尼9",
    worker_english_name: "",
    passport_no: "",
    employment_start: "7/1/2023",
    nationality: "China3",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 140,
    worker_code: "66",
    worker_name: "张翠花",
    worker_english_name: "ZHANG CUIHUA",
    passport_no: "EM2060481",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 141,
    worker_code: "68",
    worker_name: "张小花",
    worker_english_name: "ZHANG XIAOHUA",
    passport_no: "EK3686043",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 142,
    worker_code: "4",
    worker_name: "刘阳阳",
    worker_english_name: "LIU, YANGYANG",
    passport_no: "E89196468",
    employment_start: "",
    nationality: "China3",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 143,
    worker_code: "99",
    worker_name: "临时99号",
    worker_english_name: "Part time 99",
    passport_no: "",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 144,
    worker_code: "11",
    worker_name: "唐素",
    worker_english_name: "TANG SU",
    passport_no: "EE3095973",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 145,
    worker_code: "-88",
    worker_name: "临时88号",
    worker_english_name: "Part time 88",
    passport_no: "",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 146,
    worker_code: "77",
    worker_name: "刘洋洋",
    worker_english_name: "LIU, YANGYANG",
    passport_no: "",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 147,
    worker_code: "88",
    worker_name: "印尼88",
    worker_english_name: "",
    passport_no: "",
    employment_start: "",
    nationality: "China3",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 148,
    worker_code: "23",
    worker_name: "陈可",
    worker_english_name: "CHEN KE",
    passport_no: "EJ7744038",
    employment_start: "7/1/2023",
    nationality: "China3",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 149,
    worker_code: "67",
    worker_name: "唐素",
    worker_english_name: "TANG SU",
    passport_no: "EE3095973",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 150,
    worker_code: "8",
    worker_name: "SURYATI",
    worker_english_name: "",
    passport_no: "",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: "M"
  },
  {
    legacy_id: 151,
    worker_code: "07",
    worker_name: "",
    worker_english_name: "",
    passport_no: "",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 152,
    worker_code: "3",
    worker_name: "马素平",
    worker_english_name: "MA SUPING",
    passport_no: "",
    employment_start: "",
    nationality: "China2",
    terminated: "",
    field1: ""
  },
  {
    legacy_id: 153,
    worker_code: "2",
    worker_name: "韩凤菊",
    worker_english_name: "HAN FENGJU",
    passport_no: "",
    employment_start: "",
    nationality: "",
    terminated: "",
    field1: ""
  }
];

workers.forEach(w => {
  const stmt = db.prepare(
    `INSERT INTO workers (
      company_id, legacy_id, worker_code, worker_name, worker_english_name,
      passport_no, employment_start, nationality, terminated, field1
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  stmt.run(
    1,  // company_id = 1
    w.legacy_id,
    w.worker_code,
    w.worker_name,
    w.worker_english_name,
    w.passport_no,
    w.employment_start,
    w.nationality,
    w.terminated,
    w.field1
  );

  stmt.finalize();
});


console.log("✅ Workers table seeded successfully.");
