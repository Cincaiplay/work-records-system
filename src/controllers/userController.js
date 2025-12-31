import { getAllUsers, createUser } from "../models/userModel.js";

export const getUsers = async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const createUserController = async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    const user = await createUser(name, email);
    res.status(201).json(user);
  } catch (error) {
    console.error("Error creating user:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};
