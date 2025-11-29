require('dotenv').config();
const mongoose = require('mongoose');
const News = require('./models/News');
const Category = require('./models/Category');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

const categories = [
  { name: 'Breaking News', slug: 'breaking', order: 1 },
  { name: 'India', slug: 'india', order: 2 },
  { name: 'World', slug: 'world', order: 3 },
  { name: 'Sports', slug: 'sports', order: 4 },
  { name: 'Entertainment', slug: 'entertainment', order: 5 },
  { name: 'Business', slug: 'business', order: 6 },
  { name: 'Technology', slug: 'technology', order: 7 },
  { name: 'Health', slug: 'health', order: 8 },
  { name: 'Education', slug: 'education', order: 9 },
  { name: 'Lifestyle', slug: 'lifestyle', order: 10 },
  { name: 'Auto', slug: 'auto', order: 11 },
  { name: 'Religion', slug: 'religion', order: 12 },
  { name: 'Ujala News', slug: 'ujala', order: 13 },
  { name: 'Moradabad Ujala', slug: 'moradabad-ujala', order: 14 },
];

const sampleNews = [
  {
    title: 'भारत ने ऑस्ट्रेलिया को हराकर जीती T20 सीरीज',
    description: 'टीम इंडिया ने शानदार प्रदर्शन करते हुए ऑस्ट्रेलिया को हराया और सीरीज पर कब्जा किया।',
    content: 'टीम इंडिया ने ऑस्ट्रेलिया के खिलाफ पांचवें T20 मैच में शानदार जीत दर्ज की। भारतीय टीम ने पहले बैटिंग करते हुए 180 रन बनाए। गिल और शर्मा की तूफानी शुरुआत रही। गेंदबाजों ने भी शानदार प्रदर्शन किया और ऑस्ट्रेलिया को 160 रनों पर रोक दिया। यह जीत भारत के लिए बहुत महत्वपूर्ण है।',
    category: 'sports',
    imageUrl: 'https://via.placeholder.com/800x450?text=India+vs+Australia',
    isFeatured: true,
    isBreaking: true,
    tags: ['cricket', 'india', 'australia', 't20'],
    views: 15000,
  },
  {
    title: 'दिल्ली में प्रदूषण का स्तर खतरनाक, AQI 400 के पार',
    description: 'राजधानी दिल्ली में प्रदूषण का स्तर खतरनाक स्तर पर पहुंच गया है। AQI 400 से ऊपर।',
    content: 'दिल्ली-NCR में वायु प्रदूषण गंभीर स्तर पर पहुंच गया है। आज सुबह कई इलाकों में AQI 400 से ऊपर रिकॉर्ड किया गया। सरकार ने लोगों से घरों में रहने की सलाह दी है। स्कूलों को ऑनलाइन कक्षाओं का निर्देश दिया गया है। विशेषज्ञों ने पराली जलाने और वाहनों के प्रदूषण को मुख्य कारण बताया है।',
    category: 'india',
    imageUrl: 'https://via.placeholder.com/800x450?text=Delhi+Pollution',
    isFeatured: true,
    isBreaking: true,
    tags: ['delhi', 'pollution', 'aqi', 'environment'],
    views: 23000,
  },
  {
    title: 'शेयर बाजार में तेजी, सेंसेक्स 500 अंक ऊपर',
    description: 'आज शेयर बाजार में जबरदस्त तेजी देखने को मिली। सेंसेक्स और निफ्टी दोनों में बढ़त।',
    content: 'शेयर बाजार में आज जबरदस्त तेजी देखी गई। सेंसेक्स 500 अंक की बढ़त के साथ बंद हुआ। IT और बैंकिंग सेक्टर में खासी खरीदारी देखी गई। विदेशी निवेशकों की खरीदारी भी जारी रही। विशेषज्ञों का मानना है कि सकारात्मक आर्थिक आंकड़ों से बाजार में उत्साह बना हुआ है।',
    category: 'business',
    imageUrl: 'https://via.placeholder.com/800x450?text=Stock+Market',
    tags: ['stock market', 'sensex', 'nifty', 'economy'],
    views: 8500,
  },
  {
    title: 'नई iPhone 16 सीरीज लॉन्च, कीमत और फीचर्स',
    description: 'Apple ने भारत में नई iPhone 16 सीरीज लॉन्च की। जानें कीमत और खास फीचर्स।',
    content: 'Apple ने भारत में iPhone 16 सीरीज लॉन्च कर दी है। इसमें A18 चिप, बेहतर कैमरा और लंबी बैटरी लाइफ दी गई है। iPhone 16 की शुरुआती कीमत 79,900 रुपये है। Pro मॉडल्स में टाइटेनियम डिजाइन और 48MP कैमरा है। प्री-ऑर्डर इस सप्ताह से शुरू होंगे।',
    category: 'technology',
    imageUrl: 'https://via.placeholder.com/800x450?text=iPhone+16',
    isFeatured: true,
    tags: ['iphone', 'apple', 'smartphone', 'technology'],
    views: 12000,
  },
  {
    title: 'बिहार विधानसभा चुनाव: पहले चरण में 65% मतदान',
    description: 'बिहार विधानसभा चुनाव के पहले चरण में शांतिपूर्ण ढंग से 65 प्रतिशत मतदान हुआ।',
    content: 'बिहार विधानसभा चुनाव के पहले चरण में 65 प्रतिशत से अधिक मतदान दर्ज किया गया। चुनाव आयोग के अनुसार मतदान शांतिपूर्ण रहा। प्रमुख दलों ने जीत का दावा किया है। दूसरे चरण का मतदान अगले हफ्ते होगा। परिणाम 15 नवंबर को घोषित होंगे।',
    category: 'india',
    imageUrl: 'https://via.placeholder.com/800x450?text=Bihar+Election',
    isBreaking: true,
    tags: ['bihar', 'election', 'voting', 'politics'],
    views: 18500,
  },
  {
    title: 'सर्दियों में रखें अपनी सेहत का ध्यान, जानें टिप्स',
    description: 'सर्दियों के मौसम में स्वस्थ रहने के लिए इन आसान टिप्स को अपनाएं।',
    content: 'सर्दियों का मौसम शुरू हो गया है। इस मौसम में अपनी सेहत का खास ख्याल रखना जरूरी है। गर्म पानी पिएं, विटामिन C युक्त फल खाएं, नियमित व्यायाम करें। सूखे मेवे और गुड़ का सेवन फायदेमंद है। ठंड से बचने के लिए गर्म कपड़े पहनें।',
    category: 'health',
    imageUrl: 'https://via.placeholder.com/800x450?text=Winter+Health',
    tags: ['health', 'winter', 'tips', 'wellness'],
    views: 6200,
  },
  {
    title: 'बॉलीवुड: नई फिल्म का ट्रेलर रिलीज, तोड़े रिकॉर्ड',
    description: 'सलमान खान की नई फिल्म का ट्रेलर रिलीज हुआ। 24 घंटे में 50 मिलियन व्यूज।',
    content: 'बॉलीवुड सुपरस्टार सलमान खान की आगामी फिल्म का ट्रेलर रिलीज हो गया है। ट्रेलर को 24 घंटे में 50 मिलियन से अधिक व्यूज मिले। फैंस ने सोशल मीडिया पर जमकर प्रशंसा की। फिल्म दिवाली पर रिलीज होगी। कैटरीना कैफ मुख्य भूमिका में हैं।',
    category: 'entertainment',
    imageUrl: 'https://via.placeholder.com/800x450?text=Bollywood+Movie',
    isFeatured: true,
    tags: ['bollywood', 'salman khan', 'movie', 'trailer'],
    views: 25000,
  },
  {
    title: 'अमेरिका: राष्ट्रपति चुनाव के नतीजे आज',
    description: 'अमेरिका में राष्ट्रपति चुनाव के नतीजे आज घोषित होंगे। कांटे की टक्कर।',
    content: 'अमेरिका में राष्ट्रपति चुनाव के परिणाम आज घोषित होंगे। सभी एक्जिट पोल कांटे की टक्कर का अनुमान लगा रहे हैं। दोनों प्रमुख पार्टियों ने जीत का दावा किया है। मतगणना जारी है। दुनिया भर की निगाहें अमेरिकी चुनाव पर टिकी हैं।',
    category: 'world',
    imageUrl: 'https://via.placeholder.com/800x450?text=US+Election',
    isBreaking: true,
    tags: ['usa', 'election', 'president', 'world'],
    views: 32000,
  },
];

const seedDatabase = async () => {
  try {
    await connectDB();

    // Clear existing data
    await News.deleteMany({});
    await Category.deleteMany({});

    console.log('Existing data cleared');

    // Insert categories
    await Category.insertMany(categories);
    console.log('Categories seeded successfully');

    // Insert news
    await News.insertMany(sampleNews);
    console.log('News seeded successfully');

    console.log('Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
