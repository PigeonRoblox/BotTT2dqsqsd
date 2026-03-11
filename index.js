const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc } = require('firebase/firestore');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Firebase config (même que ton site) ──
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAIJO9lD7lL-tgFgO3bxnz0guoREVa1lQg",
  authDomain: "db-d5a6b.firebaseapp.com",
  projectId: "db-d5a6b",
  storageBucket: "db-d5a6b.firebasestorage.app",
  messagingSenderId: "848019546663",
  appId: "1:848019546663:web:a69fe9bd1ce9731a962402"
};

const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── Charger les posts depuis Firebase ──
async function loadPosts() {
  const snap = await getDoc(doc(db, 'securedb', 'profiles'));
  return snap.exists() ? snap.data().list : [];
}

// ── Sauvegarder les posts dans Firebase ──
async function savePosts(list) {
  await setDoc(doc(db, 'securedb', 'profiles'), { list });
}

// ── Construire le texte complet d'un post pour la recherche ──
function getPostText(p) {
  const parts = [
    p.name || '',
    p.title || '',
    p.bio || '',
    p.city || '',
    p.country || '',
    p.music || '',
    p.game || '',
    p.languages || '',
    p.mbti || '',
    p.gender || '',
    p.quote || '',
    p.looking || '',
    p.fileName || '',
    p.fileContent || '',
    ...(p.hobbies || []),
  ];
  return parts.join(' ');
}

// ── Trouver les positions où un terme est trouvé dans le texte ──
function findTermPositions(text, term) {
  const positions = [];
  const lower = text.toLowerCase();
  const tl = term.toLowerCase();
  let idx = lower.indexOf(tl);
  while (idx !== -1) {
    positions.push(idx);
    idx = lower.indexOf(tl, idx + 1);
  }
  return positions;
}

// ── Extraire le contexte autour d'une position ──
function getContext(text, pos, termLen, contextLen = 40) {
  const start = Math.max(0, pos - contextLen);
  const end = Math.min(text.length, pos + termLen + contextLen);
  let snippet = text.slice(start, end);
  // Mettre le terme en majuscules dans le snippet
  const before = snippet.slice(0, pos - start);
  const match = snippet.slice(pos - start, pos - start + termLen);
  const after = snippet.slice(pos - start + termLen);
  return (start > 0 ? '...' : '') + before + match.toUpperCase() + after + (end < text.length ? '...' : '');
}

// ── Télécharger un fichier depuis une URL ──
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `dl_${Date.now()}`);
    const file = fs.createWriteStream(tmp);
    const protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        fs.unlinkSync(tmp);
        resolve(downloadFile(res.headers.location));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(tmp);
      });
    }).on('error', (e) => {
      fs.unlink(tmp, () => {});
      reject(e);
    });
  });
}

// ══════════════════════════════
//   COMMANDES SLASH
// ══════════════════════════════
const commands = [
  new SlashCommandBuilder()
    .setName('fastsearch')
    .setDescription('Find something fastly in the database')
    .addStringOption(opt =>
      opt.setName('terme').setDescription('Le terme à chercher').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('bettersearch')
    .setDescription('Recherche approfondie avec export fichier texte')
    .addStringOption(opt =>
      opt.setName('terme1').setDescription('term to search').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('terme2').setDescription('Second term to search but not obligatory').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('createpost')
    .setDescription('Create a post for the data base')
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Post type: profile, folder ou autopost')
        .setRequired(true)
        .addChoices(
          { name: 'Profile', value: 'profil' },
          { name: 'Folder', value: 'fichier' },
          { name: 'Autopost', value: 'autopost' },
        )
    )
    .addStringOption(opt =>
      opt.setName('fichier')
        .setDescription('Text or .raw url from pastebin or github')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('title').setDescription('[PROFILE ONLY] Profil Title').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('desc').setDescription('[PROFILE ONLY] Profil bio/desc').setRequired(false)
    ),
];

// ══════════════════════════════
//   BOT DISCORD
// ══════════════════════════════
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`✅ Bot connected as ${client.user.tag}`);

  // Enregistrer les slash commands
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log('✅ Slash commands saved globaly');
  } catch (e) {
    console.error('Erreur enregistrement commands:', e);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ── /fastsearch ──
  if (interaction.commandName === 'fastsearch') {
    await interaction.deferReply();
    const terme = interaction.options.getString('terme');

    try {
      const posts = await loadPosts();
      const found = posts.filter(p => getPostText(p).toLowerCase().includes(terme.toLowerCase()));

      if (!found.length) {
        return interaction.editReply(
          `Sorry we couldn't find anything on your topic. But you still can add it to our data base by simply using \`/createpost\` or by creating a post directly in the website.`
        );
      }

      let msg = `We found **${found.length}** result${found.length > 1 ? 's' : ''} ! Here are them :\n\n`;
      for (const p of found.slice(0, 20)) {
        const nom = p.name || p.title || p.fileName || 'Post sans titre';
        msg += `• **${nom}**\n`;
      }
      if (found.length > 20) msg += `\n_...et ${found.length - 20} autres résultats._`;

      interaction.editReply(msg);
    } catch (e) {
      console.error(e);
      interaction.editReply('❌ Error while searching. Please provide text or an .raw url from github or pastebin');
    }
  }

  // ── /bettersearch ──
  else if (interaction.commandName === 'bettersearch') {
    await interaction.deferReply();
    const terme1 = interaction.options.getString('terme1');
    const terme2 = interaction.options.getString('terme2');
    const termes = [terme1, terme2].filter(Boolean);

    try {
      const posts = await loadPosts();

      // Post doit contenir AU MOINS un des termes
      const found = posts.filter(p => {
        const txt = getPostText(p).toLowerCase();
        return termes.some(t => txt.includes(t.toLowerCase()));
      });

      if (!found.length) {
        return interaction.editReply(
          `Sorry we couldn't find anything on your topic. But you still can add it to our data base by simply using \`/createpost\` or by creating a post directly in the website.`
        );
      }

      // Générer le fichier texte
      let content = `SecureDB — Results of search\n`;
      content += `Terms searched : ${termes.join(', ')}\n`;
      content += `Date : ${new Date().toLocaleString('fr-FR')}\n`;
      content += `${'='.repeat(60)}\n\n`;

      for (const p of found) {
        const nom = p.name || p.title || p.fileName || 'Post sans titre';
        const texte = getPostText(p);

        content += `POST NAME : ${nom}\n`;
        content += `${'-'.repeat(40)}\n`;

        // Contenu du post (résumé si trop long)
        const contenu = texte.slice(0, 600);
        content += `CONTENT :\n${contenu}${texte.length > 600 ? '...' : ''}\n\n`;

        // Endroits où les termes ont été trouvés (en MAJUSCULES)
        content += `TERMS FOUND :\n`;
        for (const terme of termes) {
          const positions = findTermPositions(texte, terme);
          if (positions.length) {
            content += `  "${terme.toUpperCase()}" (${positions.length} occurrence${positions.length > 1 ? 's' : ''}) :\n`;
            for (const pos of positions.slice(0, 3)) {
              const ctx = getContext(texte, pos, terme.length);
              content += `    → ...${ctx}...\n`;
            }
            if (positions.length > 3) content += `    (et ${positions.length - 3} autres occurrences)\n`;
          }
        }
        content += `\n${'='.repeat(60)}\n\n`;
      }

      // Créer le fichier temporaire
      const tmpFile = path.join(os.tmpdir(), `securedb_results_${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, content, 'utf8');

      const attachment = new AttachmentBuilder(tmpFile, {
        name: `resultats_${termes.join('_')}.txt`
      });

      await interaction.editReply({
        content: `✅ We found **${found.length}** result${found.length > 1 ? 's' : ''}** for: \`${termes.join(', ')}\`\nHere is the folder in details :`,
        files: [attachment]
      });

      fs.unlink(tmpFile, () => {});
    } catch (e) {
      console.error(e);
      interaction.editReply('❌ Erreur while better search. Please provide an text or an .raw url from github or pastebin');
    }
  }

  // ── /createpost ──
  else if (interaction.commandName === 'createpost') {
    await interaction.deferReply();
    const type = interaction.options.getString('type');
    const fichierInput = interaction.options.getString('fichier');
    const title = interaction.options.getString('title');
    const desc = interaction.options.getString('desc');

    try {
      let fileContent = '';
      let fileName = '';
      let fileExt = '.txt';

      // Détecter si c'est une URL ou du contenu direct
      const isUrl = fichierInput.startsWith('http://') || fichierInput.startsWith('https://');

      if (isUrl) {
        // Télécharger le fichier
        await interaction.editReply('⏳ Downloading file...');
        try {
          const tmpPath = await downloadFile(fichierInput);
          fileContent = fs.readFileSync(tmpPath, 'utf8');
          fs.unlink(tmpPath, () => {});
          // Extraire le nom du fichier depuis l'URL
          const urlParts = fichierInput.split('/');
          fileName = urlParts[urlParts.length - 1].split('?')[0] || 'fichier.txt';
          fileExt = path.extname(fileName) || '.txt';
        } catch (dlErr) {
          // Si le téléchargement échoue, utiliser l'URL comme contenu
          fileContent = `Source URL: ${fichierInput}`;
          fileName = 'url_ref.txt';
          console.warn('Download failed, using URL as content:', dlErr.message);
        }
      } else {
        // Contenu direct
        fileContent = fichierInput;
        fileName = 'post.txt';
      }

      const posts = await loadPosts();
      const newPost = {
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        postedBy: interaction.user.username,
      };

      if (type === 'profil') {
        // Post de type profil
        if (!title) {
          return interaction.editReply('❌ For a profile, you need to put an `title` (`/createpost type:profile folder:... title:YOUR_TITLE`).');
        }
        newPost.type = 'profile';
        newPost.name = title;
        newPost.bio = desc || fileContent.slice(0, 500);
        newPost.title = title;
        newPost.fileContent = fileContent;
        newPost.fileName = fileName;
        newPost.fileExt = fileExt;
      } else if (type === 'fichier') {
        newPost.type = 'file';
        newPost.title = title || fileName;
        newPost.fileName = fileName;
        newPost.fileExt = fileExt;
        newPost.fileContent = fileContent;
      } else if (type === 'autopost') {
        // Découper le contenu en plusieurs posts automatiques
        const lines = fileContent.split('\n').filter(l => l.trim());
        const baseName = title || 'AutoPost';
        let created = 0;

        for (let i = 0; i < lines.length; i++) {
          posts.push({
            id: `${Date.now()}_${i}`,
            createdAt: new Date().toISOString(),
            postedBy: interaction.user.username,
            type: 'file',
            title: `${baseName} ${i + 1}`,
            fileName: `${baseName}_${i + 1}.txt`,
            fileExt: '.txt',
            fileContent: lines[i],
          });
          created++;
        }

        await savePosts(posts);
        return interaction.editReply(`✅ **Autopost done !** ${created} post${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''} sous le nom **"${baseName} 1, ${baseName} 2..."** in data base.`);
      }

      posts.push(newPost);
      await savePosts(posts);

      interaction.editReply(`✅ **Post created with success !**\n📌 **Nom :** ${newPost.name || newPost.title}\n📁 **Type :** ${type}\n👤 **By :** ${interaction.user.username}\n\nVisible on the website right now !`);
    } catch (e) {
      console.error(e);
      interaction.editReply('❌ Erreur while creating post');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

// ── Keep-alive pour Replit (free tier) ──
// UptimeRobot peut ping cette URL pour garder le bot en vie
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('SecureDB Bot is running ✅');
}).listen(3000, () => console.log('🌐 Keep-alive server on port 3000'));
