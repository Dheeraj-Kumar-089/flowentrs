import { Router } from "express";
import User from "../models/user.model.js";
import passport from "passport";
import { sendAuthNotification } from "../config/mq.js";
import jwt from "jsonwebtoken";

const router = Router();


router.get('/google', passport.authenticate('google', {
    session: false,
    scope: [ 'profile', 'email' ]
}));

router.get('/google/callback', passport.authenticate('google', {
    session: false,
    failureRedirect: '/'
}), async (req, res) => {
    try {
        const { id, displayName, emails, photos } = req.user;
        let user = await User.findOne({ googleId: id });



        if (!user) {
            user = new User({
                googleId: id,
                email: emails[ 0 ].value,
                name: displayName,
                avatar: photos[ 0 ].value
            });
            await user.save();
        }

        await sendAuthNotification({
            userId: user._id,
            action: 'google_login',
            timestamp: new Date(),
            email: emails[ 0 ].value
        })

        // Generate JWT token
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // Set token in cookie
        res.cookie('token', token, {
            httpOnly: true,           // JS can't read it — XSS protection
            secure: true,             // only sent over HTTPS
            sameSite: 'none',         // allow cross-site (iframes, different subdomains)
            domain: '.projectrs.me',  // works across all *.projectrs.me subdomains
            maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
        });
        res.redirect('https://www.projectrs.me'); // Redirect to your frontend after successful login
    } catch (err) {
        console.error('Error during Google authentication:', err);
        res.redirect('/'); // Redirect to your frontend on error
    }
});

router.get('/me', async (req, res) => {
    try {
        const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];
        if (!token) return res.status(200).json({ loggedIn: false, user: null });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('name email avatar');

        return res.status(200).json({
            loggedIn: Boolean(user),
            user: user ?? null
        });
    } catch {
        return res.status(200).json({ loggedIn: false, user: null });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: '.projectrs.me'
    });
    return res.status(200).json({ message: 'Logged out successfully' });
});


export default router;
