require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');

app.use(cors());
// El webhook de Stripe debe recibir el cuerpo "raw" (sin parsear) para verificar la firma
app.post('/api/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.log(`❌ Error Webhook: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const { title, price, user } = session.metadata;

        // Actualizar Ranking
        let ideas = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        const ideaIndex = ideas.findIndex(i => i.title === title);

        if (ideaIndex !== -1) {
            ideas[ideaIndex].price = parseInt(price);
            ideas[ideaIndex].mins = 0;
            if(user) ideas[ideaIndex].user = user;
        } else {
            ideas.push({
                id: Date.now().toString(),
                title: title,
                pitch: session.metadata.pitch || 'Sin descripción',
                cat: session.metadata.cat || 'General',
                price: parseInt(price),
                mins: 0,
                user: user || 'Anónimo'
            });
        }

        fs.writeFileSync(DB_PATH, JSON.stringify(ideas, null, 2));
        console.log(`✅ Ranking actualizado: ${title} (por ${user || 'Anónimo'}) ahora tiene ${price}€`);
    }

    res.json({received: true});
});

// Para el resto de rutas, usamos JSON
app.use(express.json());

// Obtener Ranking
app.get('/api/ranking', (req, res) => {
    const ideas = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    res.json(ideas);
});

// Crear Sesión de Pago
app.post('/api/create-checkout-session', async (req, res) => {
    const { name, title, pitch, cat, price } = req.body;

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: `Inversión en idea: ${title}`,
                        description: pitch,
                    },
                    unit_amount: price * 100, // Stripe usa céntimos
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `http://localhost:3000?success=true`,
            cancel_url: `http://localhost:3000?canceled=true`,
            metadata: { name, title, pitch, cat, price: price.toString() }
        });

        res.json({ url: session.url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
