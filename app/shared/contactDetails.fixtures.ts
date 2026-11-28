/** Contact-detail examples for the detector (unit) and `aqar_strip_contacts` (database) tests. */

export const CONTACT_FIXTURES: Array<{ text: string; kind: string; detail: string }> = [
  // Phones: Western and Arabic-Indic digits, separators, prefixes.
  { text: "للتواصل 0791234567 مساءً", kind: "phone", detail: "0791234567" },
  { text: "call 079 123 4567 today", kind: "phone", detail: "079 123 4567" },
  { text: "اتصل ٠٧٩١٢٣٤٥٦٧", kind: "phone", detail: "٠٧٩١٢٣٤٥٦٧" },
  { text: "رقم ۰۷۸۱۲۳۴۵۶۷ فقط", kind: "phone", detail: "۰۷۸۱۲۳۴۵۶۷" },
  { text: "+962 79 123 4567", kind: "phone", detail: "+962 79 123 4567" },
  { text: "tel:+962-7-9123-4567.", kind: "phone", detail: "+962-7-9123-4567" },
  { text: "00962791234567", kind: "phone", detail: "00962791234567" },
  { text: "هاتف 079.123.4567", kind: "phone", detail: "079.123.4567" },
  { text: "office (06) 555-1234", kind: "phone", detail: "06) 555-1234" },
  { text: "٠٧٩ ١٢٣ ٤٥٦٧ واتس", kind: "phone", detail: "٠٧٩ ١٢٣ ٤٥٦٧" },
  { text: "79-123-4567", kind: "phone", detail: "79-123-4567" },
  // Emails and links.
  { text: "mail ahmad.k+homes@gmail.com now", kind: "email", detail: "ahmad.k+homes@gmail.com" },
  { text: "AHMAD@Example.JO", kind: "email", detail: "AHMAD@Example.JO" },
  { text: "see https://example.com/listing?id=4 for more", kind: "url", detail: "https://example.com/listing?id=4" },
  { text: "زوروا www.aqar-homes.net", kind: "url", detail: "www.aqar-homes.net" },
  { text: "chat wa.me/962791234567", kind: "url", detail: "wa.me/962791234567" },
  { text: "t.me/aqarhomes", kind: "url", detail: "t.me/aqarhomes" },
  { text: "موقعنا aqarhomes.com", kind: "url", detail: "aqarhomes.com" },
  // Handles and messenger mentions.
  { text: "follow @aqar_homes", kind: "handle", detail: "@aqar_homes" },
  { text: "راسلنا واتساب", kind: "messenger", detail: "واتساب" },
  { text: "تواصل عبر الواتس", kind: "messenger", detail: "الواتس" },
  { text: "بالواتس اب", kind: "messenger", detail: "بالواتس اب" },
  { text: "تلغرام: aqar_jo", kind: "messenger", detail: "تلغرام: aqar_jo" },
  { text: "على التيليجرام", kind: "messenger", detail: "التيليجرام" },
  { text: "صفحتنا على الفيس بوك", kind: "messenger", detail: "الفيس بوك" },
  { text: "حسابنا على انستغرام", kind: "messenger", detail: "انستغرام" },
  { text: "إنستغرام", kind: "messenger", detail: "إنستغرام" },
  { text: "WhatsApp me", kind: "messenger", detail: "WhatsApp" },
  { text: "find us on Instagram", kind: "messenger", detail: "Instagram" },
  { text: "Telegram channel", kind: "messenger", detail: "Telegram" },
  { text: "our Facebook page", kind: "messenger", detail: "Facebook" },
];

/** Listing text that must not be flagged. */
export const CLEAN_TEXTS = [
  "شقة للبيع في عبدون، 150 م²، الطابق 3",
  "السعر 1,500,000 دينار",
  "السعر 1500000 دينار",
  "بناء 2015-2016، تشطيب سوبر ديلوكس",
  "Apartment for sale in Abdoun, 3 bedrooms, 2 bathrooms.",
  "Built 2015 - 2020, renovated 28.11.2024",
  "قطعة أرض 750 م في خلدا. واجهة 25 م",
  "Instalment plans available; installment over 5 years",
  "حجر نفيس وتصميم فيسيح",
  "شقة طابقية مع كراج وحديقة",
  "Close to Mecca St. and the 7th circle",
];
